import { State } from "ts-fsrs";
import type { Modo } from "@/lib/ajustes";
import { barajar } from "@/lib/barajar";

export type Coleccion = "no-aprendidas" | "aprendidas";

/**
 * A qué colección pertenece una carta según su estado FSRS.
 *
 * Solo `Review` cuenta como aprendida. `Relearning` es una palabra que
 * superaste y luego fallaste: la sabías, ya no, y por eso baja. Meterla en
 * "aprendidas" haría que elegir esa colección trajera justo las que no sabes.
 */
export function coleccionDe(state: number): Coleccion {
  return state === State.Review ? "aprendidas" : "no-aprendidas";
}

export type Grupos<T> = {
  enCurso: T[];
  nuevas: T[];
  aprendidasVencidas: T[];
  /** Aprendidas que aún no vencían, **ya ordenadas por fecha ascendente**. */
  aprendidasFuturas: T[];
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
): { cartas: T[]; repasosFuera: number } {
  const { modo, cuantas, limiteNuevas, aleatorio } = opciones;
  const sinRecorte = cuantas === 0;

  const nuevas = sinRecorte ? grupos.nuevas.slice(0, limiteNuevas) : grupos.nuevas;
  // Adelantar es exactamente lo que `cuantas = 0` promete no hacer.
  const futuras = sinRecorte ? [] : grupos.aprendidasFuturas;

  const enCurso: Tramo<T> = { cartas: grupos.enCurso, sortear: false };
  const vencidas: Tramo<T> = { cartas: grupos.aprendidasVencidas, sortear: true };
  const porVenir: Tramo<T> = { cartas: futuras, sortear: false };
  const sinAprender: Tramo<T> = { cartas: nuevas, sortear: false };

  const tramos: Tramo<T>[] =
    modo === "no-aprendidas"
      ? [enCurso, sinAprender]
      : modo === "aprendidas"
        ? [vencidas, porVenir]
        : [enCurso, vencidas, sinAprender, porVenir];

  const cartas: T[] = [];
  for (const tramo of tramos) {
    const hueco = sinRecorte ? tramo.cartas.length : cuantas - cartas.length;
    if (!sinRecorte && hueco <= 0) break;
    if (tramo.cartas.length <= hueco) {
      cartas.push(...tramo.cartas);
      continue;
    }
    // Solo aquí hay una decisión que tomar, y solo los repasos vencidos se
    // sortean: las nuevas van en el orden de la biblioteca y las adelantadas
    // por fecha, que es lo que hace que adelantar dos días seguidos no traiga
    // lo mismo.
    const fuente = tramo.sortear ? barajar(tramo.cartas, aleatorio) : tramo.cartas;
    cartas.push(...fuente.slice(0, hueco));
  }

  const dentro = new Set(cartas);
  const repasosFuera = grupos.aprendidasVencidas.filter((c) => !dentro.has(c)).length;

  return { cartas, repasosFuera };
}
