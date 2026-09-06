import type { Card } from "ts-fsrs";

/** Una fila de `card_states` tal como la devuelve Drizzle. */
export type CardStateRow = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  state: number;
  lastReview: Date | null;
};

/** Fila -> Card. ts-fsrs usa snake_case; nuestro esquema, camelCase. */
export function toFsrsCard(row: CardStateRow): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    learning_steps: row.learningSteps,
    state: row.state,
    last_review: row.lastReview ?? undefined,
  } as Card;
}

/** Card -> columnas que hay que escribir. */
export function fromFsrsCard(card: Card): Omit<CardStateRow, "termId"> {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}
