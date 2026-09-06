import { eq } from "drizzle-orm";
import { normalizeTerm } from "@/lib/normalize";
import { sources, terms, termOccurrences, cardStates } from "@/db/schema";
import type { Database } from "@/db/types";

export type TermType = "word" | "phrasal_verb" | "expression";

export type ExtractedTerm = {
  term: string;
  type: TermType;
  translation: string;
  context: string;
  example: string;
};

export type SaveExtractionInput = {
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  items: ExtractedTerm[];
};

export type SaveExtractionResult = {
  sourceId: number;
  created: number;
  merged: number;
};

/**
 * Guarda una extracción completa en una única transacción: crea la fuente,
 * y por cada término crea el término (si es nuevo) o reutiliza el existente
 * (si ya estaba guardado), añadiendo siempre una nueva aparición.
 *
 * La deduplicación se hace por el término normalizado, así que un término
 * repetido nunca gana una segunda tarjeta ni pierde su progreso de repaso,
 * y una traducción corregida a mano por el usuario nunca se sobrescribe.
 */
export async function saveExtraction(
  db: Database,
  input: SaveExtractionInput,
): Promise<SaveExtractionResult> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({
        title: input.title,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        level: input.level,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
      })
      .returning({ id: sources.id });

    let created = 0;
    let merged = 0;

    // Bucle secuencial a propósito: dos términos iguales dentro del mismo
    // lote deben ver el primero ya insertado para fusionarse con él.
    for (const item of input.items) {
      const key = normalizeTerm(item.term);

      const existing = await tx
        .select({ id: terms.id })
        .from(terms)
        .where(eq(terms.termNormalized, key))
        .limit(1);

      let termId: number;

      if (existing.length > 0) {
        termId = existing[0].id;
        merged += 1;
      } else {
        const [inserted] = await tx
          .insert(terms)
          .values({
            term: item.term.trim(),
            termNormalized: key,
            type: item.type,
            translation: item.translation,
            level: input.level,
          })
          .returning({ id: terms.id });
        termId = inserted.id;
        await tx.insert(cardStates).values({ termId });
        created += 1;
      }

      await tx.insert(termOccurrences).values({
        termId,
        sourceId: source.id,
        context: item.context,
        example: item.example,
      });
    }

    return { sourceId: source.id, created, merged };
  });
}
