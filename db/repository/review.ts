import { and, eq, asc, gte, count, sql, type SQL } from "drizzle-orm";
import { terms, termOccurrences, cardStates, sources, reviewLogs } from "@/db/schema";
import { getAjustes } from "@/db/repository/settings";
import type { Database } from "@/db/types";
import { State, fsrs, type Grade } from "ts-fsrs";
import { toFsrsCard, fromFsrsCard } from "@/lib/fsrs";
import { inicioDelDia } from "@/lib/dia";
import { formatearPlazo } from "@/lib/plazo";
import { componerSesion, type Grupos, type VencidosFuera } from "@/lib/repaso/coleccion";
import { cupoDeNuevas, type Modo } from "@/lib/ajustes";

const programador = fsrs();

export type Valoracion = 1 | 2 | 3 | 4;

export type CartaCola = {
  termId: number;
  term: string;
  translation: string;
  type: string;
  level: string;
  /** El significado en inglés de la acepción, para distinguir `bank`/orilla de `bank`/banco. Vacío en lo extraído de un PDF. */
  senseHint: string;
  context: string;
  example: string;
  esNueva: boolean;
  /** Cuándo reaparecería con cada botón, ya formateado en español. */
  plazos: Record<Valoracion, string>;
};

/**
 * El formateo vive en `lib/plazo.ts` y se reexporta aquí para no romper a
 * quien ya lo importaba desde este módulo: el buscador del diccionario
 * también lo necesita, y ese es un componente de cliente.
 */
export { formatearPlazo };

export type OpcionesCola = {
  now: Date;
  source?: string;
  type?: string;
  /** Si no se pasa, manda el modo guardado en los ajustes. */
  modo?: Modo;
  /** Si no se pasa, manda el tamaño guardado. 0 = las que toquen hoy. */
  cuantas?: number;
  /** Fuente de azar del sorteo de repasos. Se inyecta solo en las pruebas. */
  aleatorio?: () => number;
};

/**
 * El tipo, y con él los dos contadores, vive en `lib/repaso/coleccion.ts`, que
 * es quien los calcula. Se reexporta porque la pantalla los lee y es un módulo
 * de cliente: así importa un tipo del mismo sitio del que ya importa `Cola`.
 */
export type { VencidosFuera };

export type Cola = {
  cartas: CartaCola[];
} & VencidosFuera;

/**
 * Cuántas tarjetas nuevas se han introducido hoy.
 *
 * `review_logs.state` guarda el estado que tenía la tarjeta ANTES de esa
 * respuesta, así que una fila con `state = 0` (State.New) es exactamente eso:
 * la primera vez que se contestó a esa tarjeta. Contarlas es lo que hace que
 * el tope sea diario. Sin esto, el tope se aplicaba sobre "las que todavía
 * están en estado New", y responder el lote del día las sacaba de ese estado:
 * recargar la página entregaba otro lote entero, y otro, hasta agotar la
 * biblioteca — sin ningún error visible.
 */
async function introducidasHoy(db: Database, ahora: Date): Promise<number> {
  const [fila] = await db
    .select({ cantidad: count() })
    .from(reviewLogs)
    .where(
      and(eq(reviewLogs.state, State.New), gte(reviewLogs.reviewedAt, inicioDelDia(ahora))),
    );
  return fila?.cantidad ?? 0;
}

/**
 * La cola del día, recogida en cuatro grupos:
 *
 *  - **En curso** (aprendizaje o reaprendizaje): palabras falladas hace
 *    minutos, y **solo las que ya vencen**. Las que el programador ha puesto
 *    para dentro de un rato se descartan sin entrar en ningún grupo: no se
 *    adelantan (adelantar lo que acabas de fallar no adelanta nada) y por eso
 *    tampoco cuentan como pendientes. Lo que queda aquí es trabajo de hoy, y
 *    `enCursoFuera` cuenta lo que de aquí no entre en la sesión.
 *  - **Aprendidas vencidas**: ya tocan hoy.
 *  - **Nuevas**: nunca respondidas.
 *  - **Aprendidas futuras**: ya aprendidas pero que aún no vencen. Antes de
 *    este cambio se tiraban sin entrar en ningún grupo; ahora se recogen
 *    aparte, ordenadas por fecha, porque son las que se pueden adelantar.
 *
 * Qué entra finalmente en la sesión, en qué orden y con qué recorte no se
 * decide aquí: eso vive en `componerSesion` (`lib/repaso/coleccion.ts`), que
 * recibe los cuatro grupos y el modo y tamaño de sesión pedidos.
 *
 * Un término puede tener varias apariciones (se encontró en más de una
 * fuente), así que la consulta agrupa en JavaScript por `termId` y se queda
 * con la primera aparición — igual que `listTerms` en `db/repository/terms.ts` —
 * para no devolver la misma tarjeta dos veces. "Primera" está definida por el
 * `ORDER BY` (asc(terms.id), asc(termOccurrences.id)): sin el desempate por
 * `termOccurrences.id`, qué aparición sobrevive dependería del plan de
 * consulta, no de cuál se guardó antes.
 */
export async function getDueQueue(db: Database, opts: OpcionesCola): Promise<Cola> {
  const filtros: SQL[] = [];
  if (opts.type) filtros.push(eq(terms.type, opts.type));
  if (opts.source) filtros.push(eq(sources.title, opts.source));

  const filas = await db
    .select({
      termId: terms.id,
      term: terms.term,
      translation: terms.translation,
      type: terms.type,
      level: terms.level,
      senseHint: terms.senseHint,
      context: termOccurrences.context,
      example: termOccurrences.example,
      state: cardStates.state,
      due: cardStates.due,
      stability: cardStates.stability,
      difficulty: cardStates.difficulty,
      elapsedDays: cardStates.elapsedDays,
      scheduledDays: cardStates.scheduledDays,
      reps: cardStates.reps,
      lapses: cardStates.lapses,
      learningSteps: cardStates.learningSteps,
      lastReview: cardStates.lastReview,
    })
    .from(terms)
    .innerJoin(cardStates, eq(cardStates.termId, terms.id))
    .leftJoin(termOccurrences, eq(termOccurrences.termId, terms.id))
    .leftJoin(sources, eq(sources.id, termOccurrences.sourceId))
    .where(filtros.length > 0 ? and(...filtros) : undefined)
    .orderBy(asc(terms.id), asc(termOccurrences.id));

  const vistos = new Set<number>();
  const nuevas: CartaCola[] = [];
  const enCurso: CartaCola[] = [];
  const aprendidasVencidas: CartaCola[] = [];
  const futurasConFecha: { carta: CartaCola; due: Date }[] = [];

  for (const f of filas) {
    if (vistos.has(f.termId)) continue;
    vistos.add(f.termId);

    const previsiones = programador.repeat(toFsrsCard(f), opts.now);
    const carta: CartaCola = {
      termId: f.termId,
      term: f.term,
      translation: f.translation,
      type: f.type,
      level: f.level,
      senseHint: f.senseHint,
      context: f.context ?? "",
      example: f.example ?? "",
      esNueva: f.state === State.New,
      plazos: {
        1: formatearPlazo(opts.now, previsiones[1].card.due),
        2: formatearPlazo(opts.now, previsiones[2].card.due),
        3: formatearPlazo(opts.now, previsiones[3].card.due),
        4: formatearPlazo(opts.now, previsiones[4].card.due),
      },
    };
    if (carta.esNueva) nuevas.push(carta);
    else if (f.state === State.Review) {
      // Las que aún no vencen ya no se tiran: son las que se pueden adelantar.
      if (f.due <= opts.now) aprendidasVencidas.push(carta);
      else futurasConFecha.push({ carta, due: f.due });
    } else if (f.due <= opts.now) enCurso.push(carta);
  }

  // El tope es DIARIO: lo que queda de cupo es el tope menos lo que ya se ha
  // introducido hoy, no el tope entero en cada petición. Solo actúa cuando el
  // usuario no ha pedido un tamaño de sesión; ver `componerSesion`. Y viene
  // apagado: `cupoDeNuevas` devuelve infinito mientras el tope valga 0.
  const { newCardsPerDay: tope, sessionSize, sessionMode } = await getAjustes(db);
  const limiteNuevas = cupoDeNuevas(tope, await introducidasHoy(db, opts.now));

  // La más próxima primero: adelantar al azar traería lo mismo dos días
  // seguidos y dejaría lo de pasado mañana sin tocar.
  const grupos: Grupos<CartaCola> = {
    enCurso,
    nuevas,
    aprendidasVencidas,
    aprendidasFuturas: futurasConFecha
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .map((f) => f.carta),
  };

  return componerSesion(grupos, {
    modo: opts.modo ?? sessionMode,
    cuantas: opts.cuantas ?? sessionSize,
    limiteNuevas,
    aleatorio: opts.aleatorio,
  });
}

export type EntradaRespuesta = {
  answerId: string;
  termId: number;
  rating: 1 | 2 | 3 | 4;
  now: Date;
};

/**
 * Aplica una valoración. El identificador la hace idempotente: si esa misma
 * respuesta ya se registró, no se vuelve a aplicar. Sin esto, un reintento
 * mandaría la tarjeta a una fecha equivocada sin dar ningún error visible.
 */
export async function applyAnswer(
  db: Database,
  entrada: EntradaRespuesta,
): Promise<{ aplicada: boolean; proximaFecha: Date }> {
  return db.transaction(async (tx) => {
    const yaRegistrada = await tx
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .where(eq(reviewLogs.answerId, entrada.answerId))
      .limit(1);

    const [fila] = await tx
      .select()
      .from(cardStates)
      .where(eq(cardStates.termId, entrada.termId))
      .limit(1);

    if (!fila) {
      throw new Error(`No existe ninguna tarjeta para el término ${entrada.termId}.`);
    }

    if (yaRegistrada.length > 0) {
      return { aplicada: false, proximaFecha: fila.due };
    }

    const { card } = programador.next(
      toFsrsCard(fila),
      entrada.now,
      entrada.rating as Grade,
    );

    await tx
      .update(cardStates)
      .set(fromFsrsCard(card))
      .where(eq(cardStates.termId, entrada.termId));

    await tx.insert(reviewLogs).values({
      answerId: entrada.answerId,
      termId: entrada.termId,
      rating: entrada.rating,
      state: fila.state,
      stability: fila.stability,
      difficulty: fila.difficulty,
      reviewedAt: entrada.now,
    });

    return { aplicada: true, proximaFecha: card.due };
  });
}

export type ResumenColecciones = {
  /** Lo que entraría hoy sin pedir nada: lo vencido, con el tope diario puesto. */
  hoy: { sinAprender: number; aprendidas: number };
  /** Todo lo disponible, incluido lo que habría que adelantar. */
  total: { sinAprender: number; aprendidas: number };
  /**
   * Cuántas tarjetas hay en la biblioteca, sin filtrar por estado ni por fecha.
   * Es el único contador que sirve para saber si hay vocabulario: los otros
   * cuatro filtran a propósito, así que los cuatro pueden dar 0 con la
   * biblioteca llena —toda en aprendizaje y todavía sin vencer, que es lo que
   * pasa a los pocos segundos de fallar unas cuantas palabras—. Deducirlo de
   * ellos hacía que la pantalla previa dijera "No tienes ninguna palabra
   * todavía" y mandara a añadir vocabulario que ya estaba ahí.
   */
  biblioteca: number;
};

/**
 * Los contadores de la pantalla previa. Cinco `count` sobre una tabla, en vez
 * de construir la cola entera y medirla: la pantalla se pinta antes de que el
 * usuario haya elegido nada, y construir la cola implica calcular los cuatro
 * plazos de cada carta con FSRS.
 *
 * `sinAprender` cuenta solo lo EN CURSO YA VENCIDO (más las nuevas): igual que
 * `getDueQueue`, que tira sin más las Learning/Relearning que aún no vencen en
 * vez de recogerlas en un grupo aparte (a diferencia de las aprendidas
 * futuras, que sí se guardan para poder adelantarlas). Si `total.sinAprender`
 * las contara, la pantalla ofrecería "no aprendidas" con tarjetas y la sesión
 * volvería vacía. Justo por eso hace falta `biblioteca`: es el único recuento
 * que no filtra, y el único del que se puede deducir que no hay vocabulario.
 */
export async function contarColecciones(db: Database, ahora: Date): Promise<ResumenColecciones> {
  const [fila] = await db
    .select({
      nuevas: sql<number>`count(*) filter (where ${cardStates.state} = ${State.New})::int`,
      enCursoVencidas: sql<number>`count(*) filter (where ${cardStates.state} in (${State.Learning}, ${State.Relearning}) and ${cardStates.due} <= ${ahora})::int`,
      aprendidasVencidas: sql<number>`count(*) filter (where ${cardStates.state} = ${State.Review} and ${cardStates.due} <= ${ahora})::int`,
      aprendidasTotal: sql<number>`count(*) filter (where ${cardStates.state} = ${State.Review})::int`,
      biblioteca: sql<number>`count(*)::int`,
    })
    .from(cardStates);

  const nuevas = fila?.nuevas ?? 0;
  const enCurso = fila?.enCursoVencidas ?? 0;
  const tope = (await getAjustes(db)).newCardsPerDay;
  const cupo = cupoDeNuevas(tope, await introducidasHoy(db, ahora));

  return {
    hoy: {
      sinAprender: enCurso + Math.min(nuevas, cupo),
      aprendidas: fila?.aprendidasVencidas ?? 0,
    },
    total: {
      sinAprender: enCurso + nuevas,
      aprendidas: fila?.aprendidasTotal ?? 0,
    },
    biblioteca: fila?.biblioteca ?? 0,
  };
}
