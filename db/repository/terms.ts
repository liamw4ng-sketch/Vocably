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
  // El término normalizado es media clave de deduplicación: saveExtraction
  // busca por la pareja (término normalizado, pista), con la pista vacía en
  // todo lo que viene de un PDF (ver db/repository/extraction.ts). Si no se
  // recalcula al editar `term`, una extracción futura con la forma corregida
  // no encontrará este término y creará uno duplicado en vez de fusionarse
  // con él. La otra mitad, la pista, no se edita desde aquí a propósito:
  // cambiarla sería mover la ficha a otra acepción.
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

/**
 * Cambia el nombre de una fuente, y con él el de todas sus palabras.
 *
 * Lo pidió con un ejemplo suyo: «fake_news.pdf, si las palabras asociadas a ese
 * documento quiero cambiar el nombre por ejemplo a simplemente fake».
 *
 * **Renombra por título, no por id**, porque el mismo documento extraído dos
 * veces son dos filas de `sources` con el mismo título — así es también como
 * filtra `listTerms`, y por la misma razón: para el usuario es un documento.
 * Renombrar solo una dejaría la mitad de sus palabras con el nombre viejo.
 *
 * Ponerle el nombre de otra fuente que ya existe no es un error: es fundir dos
 * documentos en uno, que es una cosa que se querrá hacer. Devuelve cuántas
 * filas se renombraron; 0 significa que ese título no existía.
 */
export async function renombrarFuente(
  db: Database,
  titulo: string,
  nuevoTitulo: string,
): Promise<number> {
  const nuevo = nuevoTitulo.trim();
  if (!nuevo) {
    // Sin nombre, la fuente desaparecería del filtro y sus palabras con ella:
    // seguirían en la biblioteca, pero sin manera de llegar a ellas por ahí.
    throw new Error("El nombre de la fuente no puede quedarse vacío.");
  }

  const filas = await db
    .update(sources)
    .set({ title: nuevo })
    .where(eq(sources.title, titulo))
    .returning({ id: sources.id });
  return filas.length;
}
