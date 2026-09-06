import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { sources, terms, termOccurrences } from "@/db/schema";
import type { Database } from "@/db/types";
import { normalizeTerm } from "@/lib/normalize";

export type TermRow = {
  id: number;
  term: string;
  type: string;
  translation: string;
  level: string;
  contexts: string[];
  examples: string[];
  /** Títulos de las fuentes en las que ha aparecido el término, sin repetir. */
  sources: string[];
};

export type TermFilters = {
  level?: string;
  type?: string;
  /** Título de la fuente. Se filtra por título y no por id porque el mismo
   *  libro extraído dos veces son dos fuentes distintas para el usuario. */
  source?: string;
  search?: string;
};

export async function listTerms(db: Database, filters: TermFilters): Promise<TermRow[]> {
  const conditions: SQL[] = [];
  if (filters.level) conditions.push(eq(terms.level, filters.level));
  if (filters.type) conditions.push(eq(terms.type, filters.type));
  if (filters.source) conditions.push(eq(sources.title, filters.source));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(ilike(terms.term, pattern), ilike(terms.translation, pattern)) as SQL,
    );
  }

  const rows = await db
    .select({
      id: terms.id,
      term: terms.term,
      type: terms.type,
      translation: terms.translation,
      level: terms.level,
      context: termOccurrences.context,
      example: termOccurrences.example,
      source: sources.title,
    })
    .from(terms)
    .leftJoin(termOccurrences, eq(termOccurrences.termId, terms.id))
    .leftJoin(sources, eq(sources.id, termOccurrences.sourceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const byId = new Map<number, TermRow>();
  for (const row of rows) {
    const current = byId.get(row.id) ?? {
      id: row.id,
      term: row.term,
      type: row.type,
      translation: row.translation,
      level: row.level,
      contexts: [],
      examples: [],
      sources: [],
    };
    if (row.context) current.contexts.push(row.context);
    if (row.example) current.examples.push(row.example);
    if (row.source && !current.sources.includes(row.source)) current.sources.push(row.source);
    byId.set(row.id, current);
  }
  return [...byId.values()];
}

export async function updateTerm(
  db: Database,
  id: number,
  fields: { term?: string; translation?: string; type?: string; level?: string },
): Promise<void> {
  // El término normalizado es la clave de deduplicación que usa saveExtraction
  // (ver db/repository/extraction.ts). Si no se recalcula al editar `term`,
  // una extracción futura con la forma corregida no encontrará este término
  // y creará uno duplicado en vez de fusionarse con él.
  const values: Partial<typeof terms.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (fields.term !== undefined) {
    values.termNormalized = normalizeTerm(fields.term);
  }

  await db.update(terms).set(values).where(eq(terms.id, id));
}

/** Borra el término; la tarjeta y las apariciones caen con él por clave foránea. */
export async function deleteTerm(db: Database, id: number): Promise<void> {
  await db.delete(terms).where(eq(terms.id, id));
}
