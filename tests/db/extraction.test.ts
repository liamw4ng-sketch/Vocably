import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { terms, termOccurrences, cardStates } from "@/db/schema";
import { eq } from "drizzle-orm";

const base = {
  title: "Libro",
  pageStart: 1,
  pageEnd: 5,
  level: "B2",
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
};

const comeAcross = {
  term: "come across",
  type: "phrasal_verb" as const,
  translation: "encontrarse con",
  context: "I came across an old photo.",
  example: "I came across a useful word today.",
};

describe("saveExtraction", () => {
  it("crea el término, su aparición y su tarjeta", async () => {
    const { db, close } = await createTestDb();
    const result = await saveExtraction(db, { ...base, items: [comeAcross] });

    expect(result.created).toBe(1);
    expect(result.merged).toBe(0);

    const savedTerms = await db.select().from(terms);
    expect(savedTerms).toHaveLength(1);
    expect(savedTerms[0].termNormalized).toBe("come across");

    const cards = await db.select().from(cardStates);
    expect(cards).toHaveLength(1);
    expect(cards[0].reps).toBe(0);
    await close();
  });

  it("no duplica un término ya guardado: añade solo la aparición", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    const result = await saveExtraction(db, {
      ...base,
      title: "Otro libro",
      items: [{ ...comeAcross, context: "We came across a problem." }],
    });

    expect(result.created).toBe(0);
    expect(result.merged).toBe(1);
    expect(await db.select().from(terms)).toHaveLength(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(2);
    await close();
  });

  it("ignora mayúsculas y espacios al detectar el duplicado", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    const result = await saveExtraction(db, {
      ...base,
      items: [{ ...comeAcross, term: "  Come   Across " }],
    });

    expect(result.merged).toBe(1);
    expect(await db.select().from(terms)).toHaveLength(1);
    await close();
  });

  it("conserva la traducción corregida a mano cuando el término se repite", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    await db
      .update(terms)
      .set({ translation: "toparse con" })
      .where(eq(terms.termNormalized, "come across"));

    await saveExtraction(db, {
      ...base,
      items: [{ ...comeAcross, translation: "encontrarse con" }],
    });

    const saved = await db.select().from(terms);
    expect(saved[0].translation).toBe("toparse con");
    await close();
  });

  it("deduplica también dentro del mismo lote", async () => {
    const { db, close } = await createTestDb();
    const result = await saveExtraction(db, {
      ...base,
      items: [comeAcross, { ...comeAcross, term: "Come across" }],
    });

    expect(result.created).toBe(1);
    expect(result.merged).toBe(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(2);
    await close();
  });

  it("guarda el consumo y el coste en la fuente", async () => {
    const { db, close } = await createTestDb();
    const { sourceId } = await saveExtraction(db, { ...base, items: [comeAcross] });
    const source = await db.query.sources.findFirst({
      where: (s, { eq: equals }) => equals(s.id, sourceId),
    });
    expect(source?.costUsd).toBeCloseTo(0.001);
    expect(source?.inputTokens).toBe(100);
    await close();
  });
});
