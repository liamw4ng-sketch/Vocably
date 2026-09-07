import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarEnDiccionario, buscarEnBiblioteca } from "@/db/repository/diccionario";
import { saveExtraction } from "@/db/repository/extraction";
import { dictionaryEntries } from "@/db/schema";

async function sembrar(db: Parameters<typeof buscarEnDiccionario>[0]) {
  await db.insert(dictionaryEntries).values([
    { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", translations: [] },
    { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", translations: [] },
    {
      termNormalized: "bite off more than one can chew",
      term: "bite off more than one can chew",
      pos: "verb",
      gloss: "To try to do too much.",
      translations: [],
    },
  ]);
}

describe("buscarEnDiccionario", () => {
  it("devuelve todas las acepciones del término", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    const filas = await buscarEnDiccionario(db, "Bank");
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.gloss)).toContain("An edge of a river.");
    await close();
  });

  it("encuentra el idiom escrito con 'you' aunque esté guardado con 'one'", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    const filas = await buscarEnDiccionario(db, "bite off more than you can chew");
    expect(filas).toHaveLength(1);
    expect(filas[0].term).toBe("bite off more than one can chew");
    await close();
  });

  it("devuelve vacío si no está", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    expect(await buscarEnDiccionario(db, "xyzzy")).toEqual([]);
    await close();
  });
});

describe("buscarEnBiblioteca", () => {
  it("encuentra un término ya guardado, con su nivel y su traducción", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, {
      title: "Libro",
      pageStart: 1,
      pageEnd: 5,
      level: "B2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: [
        {
          term: "come across",
          type: "phrasal_verb",
          translation: "encontrarse con",
          context: "I came across an old photo.",
          example: "I came across a useful word.",
        },
      ],
    });

    const guardados = await buscarEnBiblioteca(db, "Come Across");
    expect(guardados).toHaveLength(1);
    expect(guardados[0].translation).toBe("encontrarse con");
    expect(guardados[0].level).toBe("B2");
    expect(guardados[0].senseHint).toBe("");
    await close();
  });

  it("encuentra un término guardado bajo una variante del lema, buscando con otra", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, {
      title: "Novela",
      pageStart: 10,
      pageEnd: 20,
      level: "C1",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: [
        {
          term: "bite off more than one can chew",
          type: "expression",
          translation: "abarcar más de lo que se puede",
          context: "He bit off more than one could chew.",
          example: "Don't bite off more than one can chew.",
        },
      ],
    });

    const guardados = await buscarEnBiblioteca(db, "bite off more than you can chew");
    expect(guardados).toHaveLength(1);
    expect(guardados[0].term).toBe("bite off more than one can chew");
    expect(guardados[0].translation).toBe("abarcar más de lo que se puede");
    expect(guardados[0].level).toBe("C1");
    expect(guardados[0].senseHint).toBe("");
    await close();
  });

  it("devuelve vacío si el término no está en la biblioteca", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarEnBiblioteca(db, "come across")).toEqual([]);
    await close();
  });
});
