import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  level: text("level").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
});

export const terms = pgTable(
  "terms",
  {
    id: serial("id").primaryKey(),
    term: text("term").notNull(),
    termNormalized: text("term_normalized").notNull(),
    type: text("type").notNull(),
    translation: text("translation").notNull(),
    level: text("level").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    termNormalizedIdx: uniqueIndex("terms_term_normalized_idx").on(table.termNormalized),
  }),
);

export const termOccurrences = pgTable("term_occurrences", {
  id: serial("id").primaryKey(),
  termId: integer("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  context: text("context").notNull(),
  example: text("example").notNull(),
});

/** Estado de repetición espaciada. Se crea en la fase 1; lo usa la fase 2. */
export const cardStates = pgTable("card_states", {
  termId: integer("term_id")
    .primaryKey()
    .references(() => terms.id, { onDelete: "cascade" }),
  due: timestamp("due").notNull().defaultNow(),
  stability: doublePrecision("stability").notNull().default(0),
  difficulty: doublePrecision("difficulty").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  learningSteps: integer("learning_steps").notNull().default(0),
  state: integer("state").notNull().default(0),
  lastReview: timestamp("last_review"),
});

/** Histórico de respuestas. Vacío en la fase 1; se crea para no perder datos después. */
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: serial("id").primaryKey(),
    termId: integer("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    state: integer("state").notNull(),
    stability: doublePrecision("stability").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
    /** Id de idempotencia enviado por el cliente: repetir una respuesta no duplica el log. */
    answerId: text("answer_id").notNull(),
  },
  (table) => ({
    answerIdIdx: uniqueIndex("review_logs_answer_id_idx").on(table.answerId),
  }),
);

/** Ajustes de la app, tabla de una sola fila. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  newCardsPerDay: integer("new_cards_per_day").notNull().default(20),
});
