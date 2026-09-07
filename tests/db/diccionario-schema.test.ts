import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { dictionaryEntries } from "@/db/schema";

describe("dictionary_entries", () => {
  it("guarda una acepción con su ejemplo y sus traducciones", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "come across",
      term: "come across",
      pos: "verb",
      gloss: "To find, usually by accident.",
      example: "He came across an old box.",
      translations: ["encontrar", "toparse con"],
    });

    const filas = await db.select().from(dictionaryEntries);
    expect(filas).toHaveLength(1);
    expect(filas[0].translations).toEqual(["encontrar", "toparse con"]);
    expect(filas[0].translationSource).toBeNull();
    await close();
  });

  it("admite dos acepciones del mismo término: no hay índice único", async () => {
    const { db, close } = await createTestDb();
    const base = { termNormalized: "bank", term: "bank", pos: "noun", translations: [] };
    await db.insert(dictionaryEntries).values({ ...base, gloss: "A financial institution." });
    await db.insert(dictionaryEntries).values({ ...base, gloss: "An edge of a river." });

    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("admite una acepción sin ejemplo ni traducciones", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "thorough",
      term: "thorough",
      pos: "adj",
      gloss: "Painstakingly careful.",
    });
    const [fila] = await db.select().from(dictionaryEntries);
    expect(fila.example).toBeNull();
    expect(fila.translations).toEqual([]);
    await close();
  });
});
