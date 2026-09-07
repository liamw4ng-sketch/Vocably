import { and, eq, asc, gte, count, type SQL } from "drizzle-orm";
import { terms, termOccurrences, cardStates, sources, reviewLogs } from "@/db/schema";
import { getAjustes } from "@/db/repository/settings";
import type { Database } from "@/db/types";
import { State, fsrs, type Grade } from "ts-fsrs";
import { toFsrsCard, fromFsrsCard } from "@/lib/fsrs";
import { inicioDelDia } from "@/lib/dia";
import { barajar } from "@/lib/barajar";

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

/** Un decimal; si termina en ",0" se recorta; singular si el número es exactamente 1. */
function formatUnidad(cantidad: number, singular: string, plural: string): string {
  const conDecimal = cantidad.toFixed(1);
  const texto = conDecimal.endsWith(".0") ? conDecimal.slice(0, -2) : conDecimal;
  const esUno = texto === "1";
  return `${texto.replace(".", ",")} ${esUno ? singular : plural}`;
}

/** "1 min", "10 min", "8 días", "1,3 años". Nunca se escriben a mano. */
export function formatearPlazo(desde: Date, hasta: Date): string {
  const minutos = Math.round((hasta.getTime() - desde.getTime()) / 60000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.round(minutos / 1440);
  if (dias < 30) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = dias / 30.4;
  if (meses < 12) return formatUnidad(meses, "mes", "meses");
  return formatUnidad(dias / 365, "año", "años");
}

export type OpcionesCola = {
  now: Date;
  source?: string;
  type?: string;
  /** Acción explícita del usuario: introducir tarjetas nuevas por encima del tope del día. */
  adelantar?: boolean;
  /** Fuente de azar del sorteo de repasos. Se inyecta solo en las pruebas. */
  aleatorio?: () => number;
};

export type Cola = {
  cartas: CartaCola[];
  /**
   * Repasos que vencían hoy y que el límite por sesión dejó fuera. No se han
   * perdido: siguen vencidos y entran en la sesión siguiente. La pantalla lo
   * dice, porque un límite por debajo del ritmo diario acumula atrasos en
   * silencio hasta que la cola es impagable.
   */
  repasosFuera: number;
};

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
 * La cola del día, en tres grupos:
 *
 *  - **En curso** (aprendizaje o reaprendizaje): palabras falladas hace
 *    minutos. Van siempre enteras y nunca entran en el sorteo.
 *  - **Aprendidas** vencidas: si hay más de las que caben en la sesión, se
 *    sortean. Las que quedan fuera siguen vencidas para la próxima.
 *  - **Nuevas**: hasta el cupo que quede del tope diario.
 *
 * El sorteo solo actúa cuando hay que elegir. Si caben todas, el orden no se
 * toca: introducir azar donde no hay decisión que tomar solo haría las
 * sesiones irreproducibles sin ganar nada.
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
  const aprendidas: CartaCola[] = [];

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
    else if (f.due <= opts.now) {
      if (f.state === State.Review) aprendidas.push(carta);
      else enCurso.push(carta);
    }
  }

  // El tope es DIARIO: lo que queda de cupo es el tope menos lo que ya se ha
  // introducido hoy, no el tope entero en cada petición.
  //
  // El tope es además un ritmo por defecto, no un muro: el usuario puede
  // pedir adelantar material nuevo, pero la app nunca se lo salta sola.
  // Adelantar concede OTRO LOTE del tamaño del tope sobre lo ya introducido
  // hoy (cupo = tope, se hubiera gastado o no), no el doble de un cupo que ya
  // está gastado —que no daría nada, que es el estado en el que la interfaz
  // enseña el botón— ni todo lo que quede en la biblioteca: el spec de diseño
  // dice "otro lote", y un tope diario que un botón se salta sin límite deja
  // de ser un tope.
  const { newCardsPerDay: tope, reviewsPerSession: limiteRepasos } = await getAjustes(db);
  const limiteNuevas = opts.adelantar
    ? tope
    : Math.max(0, tope - (await introducidasHoy(db, opts.now)));

  // 0 significa "todos los que venzan": la app no recorta el repaso por su
  // cuenta, solo si el usuario ha pedido un tamaño de sesión.
  const hayQueElegir = limiteRepasos > 0 && aprendidas.length > limiteRepasos;
  const repasos = hayQueElegir
    ? barajar(aprendidas, opts.aleatorio).slice(0, limiteRepasos)
    : aprendidas;

  return {
    cartas: [...enCurso, ...repasos, ...nuevas.slice(0, limiteNuevas)],
    repasosFuera: aprendidas.length - repasos.length,
  };
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
