import { z } from "zod";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];

export function isCefrLevel(value: string): value is CefrLevel {
  return (CEFR_LEVELS as readonly string[]).includes(value);
}

export const extractedTermSchema = z.object({
  term: z.string().min(1).describe("El término, verbo frasal o expresión, en inglés"),
  type: z
    .enum(["word", "phrasal_verb", "expression"])
    .describe("word para palabras sueltas, phrasal_verb para verbos frasales, expression para expresiones"),
  translation: z.string().min(1).describe("Traducción al español"),
  context: z.string().min(1).describe("Frase corta copiada literalmente del texto"),
  example: z.string().min(1).describe("Ejemplo práctico de uso, distinto de la frase del texto"),
});

export const extractionSchema = z.object({
  terms: z.array(extractedTermSchema),
});

export type Extraction = z.infer<typeof extractionSchema>;
