import type { Modo } from "@/lib/ajustes";
import { barajar } from "@/lib/barajar";

export type Coleccion = "no-aprendidas" | "aprendidas";

/**
 * A partir de qué botón de la tarjeta se considera aprendida una palabra:
 * "Bien" (3) y "Fácil" (4) sí, "Otra vez" (1) y "Difícil" (2) no.
 */
export const APRENDIDA_DESDE = 3;

/**
 * A qué colección pertenece una carta, según **la última respuesta del
 * usuario** en esa palabra.
 *
 * Antes miraba el estado del programador FSRS, y esa era la decisión
 * equivocada: a FSRS le da igual qué botón pulses, así que una palabra
 * respondida "Difícil" acababa en "aprendidas" exactamente igual que una
 * "Fácil". Él lo dijo con sus palabras al usarlo: «si digo que es fácil o ya me
 * lo sé, pues se va en la categoría de aprendidas», y las difíciles «allí se
 * quedan aún en no aprendidas».
 *
 * `null` es una palabra que todavía no has respondido nunca. Es nueva, y una
 * palabra nueva no está aprendida.
 */
export function coleccionDe(ultimaValoracion: number | null): Coleccion {
  return ultimaValoracion !== null && ultimaValoracion >= APRENDIDA_DESDE
    ? "aprendidas"
    : "no-aprendidas";
}

export type Grupos<T> = {
  /**
   * En aprendizaje o reaprendizaje y **ya vencidas**: quien reúne los grupos
   * descarta las que aún no vencen, porque adelantar una palabra que acabas de
   * fallar no es adelantar nada. `enCursoFuera` cuenta sobre esa premisa: todo
   * lo que hay aquí es trabajo de hoy.
   */
  enCurso: T[];
  nuevas: T[];
  /**
   * Sin aprender y todavía sin vencer: falladas hace un rato que el programador
   * ha puesto para dentro de unos minutos. **Ya ordenadas por fecha ascendente.**
   * Solo entran cuando se pide expresamente la categoría "No aprendidas".
   */
  noAprendidasFuturas: T[];
  aprendidasVencidas: T[];
  /** Aprendidas que aún no vencían, **ya ordenadas por fecha ascendente**. */
  aprendidasFuturas: T[];
};

/**
 * Lo vencido hoy que la sesión dejó fuera, repartido por colección. No se ha
 * perdido nada: sigue vencido y entra en la sesión siguiente. La pantalla lo
 * dice, porque una sesión por debajo del ritmo diario acumula atrasos en
 * silencio hasta que la cola es impagable.
 *
 * Van por separado y no sumados porque quien lo lee tiene que decidir con qué
 * modo se sigue, y no hay ningún modo que traiga las dos: "aprendidas" nunca
 * cuela una en curso y "no aprendidas" nunca cuela un repaso. Un solo número
 * diría cuántas quedan pero no a cuál de las dos colecciones ir a buscarlas, y
 * un botón que lleva a la colección equivocada devuelve una sesión vacía.
 */
export type VencidosFuera = {
  /** Aprendidas vencidas que no entraron, por el número pedido o por el modo. */
  repasosFuera: number;
  /** En curso vencidas que no entraron, por lo mismo. */
  enCursoFuera: number;
};

export type OpcionesSesion = {
  modo: Modo;
  cuantas: number;
  /** Cupo diario de nuevas que queda. Solo se aplica con `cuantas === 0`. */
  limiteNuevas: number;
  /** Fuente de azar del sorteo. Se inyecta solo en las pruebas. */
  aleatorio?: () => number;
};

/** Un grupo y si se puede sortear cuando hay que recortarlo. */
type Tramo<T> = { cartas: T[]; sortear: boolean };

/**
 * Compone la sesión a partir de los cuatro grupos.
 *
 * Genérica sobre la carta a propósito: así este módulo no importa nada de
 * `db/repository/review.ts` —que sí importa a este— y se prueba con objetos de
 * una línea.
 *
 * `limiteNuevas` solo manda cuando `cuantas === 0`. Con un número explícito
 * manda el número, incluso por encima del tope diario: es una decisión del
 * usuario, y la regla vive aquí en vez de repartida entre esta función y quien
 * la llama.
 */
export function componerSesion<T>(
  grupos: Grupos<T>,
  opciones: OpcionesSesion,
): { cartas: T[] } & VencidosFuera {
  const { modo, cuantas, limiteNuevas, aleatorio } = opciones;
  const sinRecorte = cuantas === 0;

  const nuevas = sinRecorte ? grupos.nuevas.slice(0, limiteNuevas) : grupos.nuevas;
  // En la mezcla, adelantar es exactamente lo que `cuantas = 0` promete no
  // hacer: es el plan del día. Pero pedir una categoría a propósito es otra
  // cosa —«la categoría aprendidas también se puede volver a testear si es
  // necesario»—, y ahí sí entran enteras.
  const enLaMezcla = modo === "mezcla";
  const futurasAprendidas = enLaMezcla && sinRecorte ? [] : grupos.aprendidasFuturas;

  const enCurso: Tramo<T> = { cartas: grupos.enCurso, sortear: true };
  const vencidas: Tramo<T> = { cartas: grupos.aprendidasVencidas, sortear: true };
  // Las que aún no tocan son el único grupo que conserva su orden, y no es
  // capricho: vienen ordenadas por fecha de vencimiento, y es eso lo que hace
  // que adelantar dos días seguidos no traiga las mismas palabras.
  const porVenir: Tramo<T> = { cartas: futurasAprendidas, sortear: false };
  const porVolver: Tramo<T> = { cartas: grupos.noAprendidasFuturas, sortear: false };
  const sinAprender: Tramo<T> = { cartas: nuevas, sortear: true };

  const tramos: Tramo<T>[] =
    modo === "no-aprendidas"
      ? [enCurso, sinAprender, porVolver]
      : modo === "aprendidas"
        ? [vencidas, porVenir]
        : [enCurso, vencidas, sinAprender, porVenir];

  const cartas: T[] = [];
  for (const tramo of tramos) {
    const hueco = sinRecorte ? tramo.cartas.length : cuantas - cartas.length;
    if (!sinRecorte && hueco <= 0) break;
    // El sorteo va aquí, antes del recorte y **entre o no entre el grupo
    // entero**. Antes solo se barajaba lo que había que recortar, así que un
    // grupo que cabía salía en el orden de la biblioteca: las mismas palabras
    // en el mismo sitio todos los días. El usuario lo notó y lo dijo.
    const fuente = tramo.sortear ? barajar(tramo.cartas, aleatorio) : tramo.cartas;
    cartas.push(...fuente.slice(0, hueco));
  }

  // Los dos grupos vencidos se miden igual. Contar solo las aprendidas era
  // cierto mientras las en curso entraban siempre; ahora las descartan tanto el
  // modo ("aprendidas" no cuela ninguna) como un número menor que el grupo, y
  // sin contarlas la pantalla felicita por haber terminado con palabras
  // falladas hace minutos todavía vencidas.
  const dentro = new Set(cartas);
  const fuera = (grupo: T[]) => grupo.filter((c) => !dentro.has(c)).length;

  return {
    cartas,
    repasosFuera: fuera(grupos.aprendidasVencidas),
    enCursoFuera: fuera(grupos.enCurso),
  };
}
