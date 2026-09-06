import { describe, it, expect } from "vitest";
import { extractionSchema, isCefrLevel } from "@/lib/extraction-schema";

const validTerm = {
  term: "come across",
  type: "phrasal_verb",
  translation: "encontrarse con",
  context: "I came across an old photo.",
  example: "I came across a useful word today.",
};

describe("extractionSchema", () => {
  it("acepta un resultado válido", () => {
    const parsed = extractionSchema.parse({ terms: [validTerm] });
    expect(parsed.terms[0].term).toBe("come across");
  });

  it("acepta una lista vacía", () => {
    expect(extractionSchema.parse({ terms: [] }).terms).toHaveLength(0);
  });

  it("rechaza un tipo de término desconocido", () => {
    expect(() =>
      extractionSchema.parse({ terms: [{ ...validTerm, type: "idiom" }] }),
    ).toThrow();
  });

  it("rechaza un término al que le falta el contexto", () => {
    // Se quita el campo en vez de desestructurarlo para descartarlo: así no
    // queda una variable sin usar, que es un aviso de ESLint.
    const sinContexto: Record<string, unknown> = { ...validTerm };
    delete sinContexto.context;
    expect(() => extractionSchema.parse({ terms: [sinContexto] })).toThrow();
  });

  it("rechaza un término vacío", () => {
    expect(() => extractionSchema.parse({ terms: [{ ...validTerm, term: "" }] })).toThrow();
  });
});

describe("isCefrLevel", () => {
  it("acepta los seis niveles del MCER", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      expect(isCefrLevel(level)).toBe(true);
    }
  });

  it("rechaza cualquier otra cosa", () => {
    expect(isCefrLevel("B3")).toBe(false);
    expect(isCefrLevel("b2")).toBe(false);
    expect(isCefrLevel("")).toBe(false);
  });
});
