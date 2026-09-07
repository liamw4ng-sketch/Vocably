import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
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
    /**
     * El significado en inglés de la acepción guardada. Vacío en todo lo que
     * viene de un PDF, que es como se conserva el comportamiento anterior:
     * la clave de deduplicación de una extracción sigue siendo el término solo.
     * Se muestra en la cara delantera de la tarjeta para distinguir
     * `bank` → orilla de `bank` → banco sin adelantar la respuesta en español.
     */
    senseHint: text("sense_hint").notNull().default(""),
  },
  (table) => ({
    termNormalizedIdx: uniqueIndex("terms_term_normalized_idx").on(
      table.termNormalized,
      table.senseHint,
    ),
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
  /** Cuántos repasos de palabras ya aprendidas entran en cada sesión. 0 = todos los que venzan. */
  reviewsPerSession: integer("reviews_per_session").notNull().default(0),
});

/**
 * El diccionario de consulta: una fila por acepción. Se carga una vez desde el
 * volcado de Wikcionario y no se vuelve a escribir, salvo la traducción, que se
 * cachea la primera vez que alguien busca el término.
 *
 * No lleva índice único: la gracia es justo que un término tenga varias
 * acepciones (`bank` tiene siete entradas en Wikcionario, una por etimología).
 */
export const dictionaryEntries = pgTable(
  "dictionary_entries",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    pos: text("pos").notNull(),
    /** El significado, en inglés: es donde Wikcionario es fuerte. */
    gloss: text("gloss").notNull(),
    example: text("example"),
    translations: text("translations").array().notNull().default([]),
    /** `wiktionary` | `mymemory` | `claude`. Nulo mientras no haya traducción. */
    translationSource: text("translation_source"),
  },
  (table) => ({
    termNormalizedIdx: index("dictionary_entries_term_normalized_idx").on(table.termNormalized),
  }),
);
