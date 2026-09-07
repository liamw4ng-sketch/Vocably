import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarEnDiccionario, traducirSiFalta } from "@/db/repository/diccionario";
import { dictionaryEntries } from "@/db/schema";

describe("traducirSiFalta", () => {
  it("traduce solo lo que no tiene español y lo guarda", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values([
      { termNormalized: "free", term: "free", pos: "adj", gloss: "Unconstrained.", translations: ["libre"] },
      { termNormalized: "free", term: "free", pos: "adj", gloss: "Without cost.", translations: [] },
    ]);

    const traductor = vi.fn(async () => ["gratis", "gratuito"]);
    const acepciones = await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);

    expect(traductor).toHaveBeenCalledTimes(1);
    expect(acepciones[0].translations).toEqual(["libre"]);
    expect(acepciones[1].translations).toEqual(["gratis", "gratuito"]);

    const guardadas = await db.select().from(dictionaryEntries);
    expect(guardadas[1].translations).toEqual(["gratis", "gratuito"]);
    expect(guardadas[1].translationSource).toBe("mymemory");
    await close();
  });

  it("la segunda búsqueda ya no llama al traductor", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "free", term: "free", pos: "adj", gloss: "Without cost.", translations: [],
    });

    const traductor = vi.fn(async () => ["gratis"]);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);

    expect(traductor).toHaveBeenCalledTimes(1);
    await close();
  });

  it("si el traductor no devuelve nada, la acepción se queda sin español y no se marca", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "xyzzy", term: "xyzzy", pos: "noun", gloss: "A magic word.", translations: [],
    });

    await traducirSiFalta(db, await buscarEnDiccionario(db, "xyzzy"), async () => []);

    const [fila] = await db.select().from(dictionaryEntries);
    expect(fila.translations).toEqual([]);
    expect(fila.translationSource).toBeNull();
    await close();
  });
});
