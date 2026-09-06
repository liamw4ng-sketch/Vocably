import { and, eq, asc, type SQL } from "drizzle-orm";
import { terms, termOccurrences, cardStates, sources } from "@/db/schema";
import { getNewCardsPerDay } from "@/db/repository/settings";
import type { Database } from "@/db/types";
import { State, fsrs } from "ts-fsrs";
import { toFsrsCard } from "@/lib/fsrs";

const programador = fsrs();

export type Valoracion = 1 | 2 | 3 | 4;

export type CartaCola = {
  termId: number;
  term: string;
  translation: string;
  type: string;
  level: string;
  context: string;
  example: string;
  esNueva: boolean;
  /** Cuándo reaparecería con cada botón, ya formateado en español. */
  plazos: Record<Valoracion, string>;
};

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
  if (meses < 12) return `${meses.toFixed(1).replace(".", ",")} meses`;
  return `${(dias / 365).toFixed(1).replace(".", ",")} años`;
}

export type OpcionesCola = { now: Date; source?: string; type?: string };

/**
 * La cola del día: todo lo vencido, más tarjetas nuevas hasta el tope diario.
 * Lo vencido nunca se recorta: el tope solo limita la entrada de material nuevo.
 *
 * Un término puede tener varias apariciones (se encontró en más de una
 * fuente), así que la consulta agrupa en JavaScript por `termId` y se queda
 * con la primera aparición — igual que `listTerms` en `db/repository/terms.ts` —
 * para no devolver la misma tarjeta dos veces.
 */
export async function getDueQueue(db: Database, opts: OpcionesCola): Promise<CartaCola[]> {
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
    .orderBy(asc(terms.id));

  const vistos = new Set<number>();
  const nuevas: CartaCola[] = [];
  const vencidas: CartaCola[] = [];

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
    else if (f.due <= opts.now) vencidas.push(carta);
  }

  const tope = await getNewCardsPerDay(db);
  return [...vencidas, ...nuevas.slice(0, tope)];
}
