import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms, updateTerm, deleteTerm } from "@/db/repository/terms";
import { cardStates, termOccurrences } from "@/db/schema";

let db: TestDb;
let closeDb: () => Promise<void>;

const base = {
  title: "Libro",
  pageStart: 1,
  pageEnd: 5,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

beforeEach(async () => {
  ({ db, close: closeDb } = await createTestDb());
  await saveExtraction(db, {
    ...base,
    level: "B2",
    items: [
      {
        term: "come across",
        type: "phrasal_verb",
        translation: "encontrarse con",
        context: "I came across a photo.",
        example: "She came across an article.",
      },
      {
        term: "reluctant",
        type: "word",
        translation: "reacio",
        context: "He was reluctant to speak.",
        example: "I was reluctant to accept.",
      },
    ],
  });
});

// Sin esto, cada prueba deja viva una instancia de PGlite.
afterEach(async () => {
  await closeDb();
});

describe("listTerms", () => {
  it("devuelve todos los términos con sus contextos", async () => {
    const rows = await listTerms(db, {});
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.term === "come across")?.contexts).toEqual([
      "I came across a photo.",
    ]);
  });

  it("filtra por tipo", async () => {
    const rows = await listTerms(db, { type: "phrasal_verb" });
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe("come across");
  });

  it("filtra por nivel", async () => {
    expect(await listTerms(db, { level: "B2" })).toHaveLength(2);
    expect(await listTerms(db, { level: "A1" })).toHaveLength(0);
  });

  it("busca por texto, sin distinguir mayúsculas", async () => {
    const rows = await listTerms(db, { search: "RELUCT" });
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe("reluctant");
  });
});

describe("listTerms con más de una fuente", () => {
  beforeEach(async () => {
    await saveExtraction(db, {
      ...base,
      title: "Otro libro",
      level: "C1",
      items: [
        {
          term: "cumbersome",
          type: "word",
          translation: "engorroso",
          context: "A cumbersome process.",
          example: "The form was cumbersome.",
        },
        // El mismo término en otra fuente: una aparición más, no un término más.
        {
          term: "reluctant",
          type: "word",
          translation: "reacio",
          context: "She was reluctant again.",
          example: "Still reluctant to sign.",
        },
      ],
    });
  });

  it("devuelve los títulos de las fuentes de cada término, sin repetirlos", async () => {
    const rows = await listTerms(db, {});
    const reluctant = rows.find((r) => r.term === "reluctant")!;

    expect([...reluctant.sources].sort()).toEqual(["Libro", "Otro libro"]);
    expect(rows.find((r) => r.term === "come across")!.sources).toEqual(["Libro"]);
  });

  it("filtra por fuente", async () => {
    const rows = await listTerms(db, { source: "Otro libro" });
    expect(rows.map((r) => r.term).sort()).toEqual(["cumbersome", "reluctant"]);
  });

  it("no devuelve nada de una fuente que no existe", async () => {
    expect(await listTerms(db, { source: "Un libro que no está" })).toHaveLength(0);
  });

  it("combina el filtro de fuente con el de tipo", async () => {
    const rows = await listTerms(db, { source: "Libro", type: "phrasal_verb" });
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe("come across");
  });
});

describe("updateTerm", () => {
  it("cambia la traducción sin tocar el estado de repaso", async () => {
    const [row] = await listTerms(db, { type: "word" });
    const before = await db.select().from(cardStates);
    await updateTerm(db, row.id, { translation: "remiso" });

    const [after] = await listTerms(db, { type: "word" });
    expect(after.translation).toBe("remiso");
    expect(await db.select().from(cardStates)).toEqual(before);
  });

  it("recalcula la clave de deduplicación al corregir el término, para que una futura extracción se fusione con él en vez de duplicarlo", async () => {
    const [row] = await listTerms(db, { type: "phrasal_verb" });
    expect(row.term).toBe("come across");

    await updateTerm(db, row.id, { term: "come across sth" });

    const result = await saveExtraction(db, {
      ...base,
      level: "B2",
      items: [
        {
          term: "Come Across STH",
          type: "phrasal_verb",
          translation: "encontrarse con algo",
          context: "New context.",
          example: "New example.",
        },
      ],
    });

    expect(result.created).toBe(0);
    expect(result.merged).toBe(1);
    expect(await listTerms(db, {})).toHaveLength(2);
  });
});

describe("deleteTerm", () => {
  it("borra el término, su tarjeta y sus apariciones", async () => {
    const [row] = await listTerms(db, { type: "word" });
    await deleteTerm(db, row.id);

    expect(await listTerms(db, {})).toHaveLength(1);
    expect(await db.select().from(cardStates)).toHaveLength(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(1);
  });
});
