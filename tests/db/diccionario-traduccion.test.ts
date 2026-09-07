import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarEnDiccionario, traducirSiFalta } from "@/db/repository/diccionario";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";
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

  it("con dos acepciones sin español, traduce una vez, las enseña las dos y no cachea ninguna", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values([
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", translations: [] },
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", translations: [] },
    ]);

    const traductor = vi.fn(async () => ["banco"]);
    const acepciones = await traducirSiFalta(db, await buscarEnDiccionario(db, "bank"), traductor);

    // Se pregunta una vez por el término, no una por acepción.
    expect(traductor).toHaveBeenCalledTimes(1);
    expect(traductor).toHaveBeenCalledWith("bank");

    // Se enseña en las dos: es lo único que hay, y algo es mejor que nada.
    expect(acepciones.map((a) => a.translations)).toEqual([["banco"], ["banco"]]);

    // Pero no se guarda: "banco" es la traducción del término, no la de la
    // acepción de orilla, y cachearla la dejaría mal para siempre.
    const guardadas = await db.select().from(dictionaryEntries);
    expect(guardadas.map((f) => f.translations)).toEqual([[], []]);
    expect(guardadas.map((f) => f.translationSource)).toEqual([null, null]);
    await close();
  });

  it("sin cachear, la segunda búsqueda de un término con varias acepciones vuelve a preguntar", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values([
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", translations: [] },
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", translations: [] },
    ]);

    const traductor = vi.fn(async () => ["banco"]);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "bank"), traductor);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "bank"), traductor);

    // Volver a preguntar es justo lo que se quiere aquí: el traductor es
    // gratis, y así una traducción dudosa no queda congelada en la base.
    expect(traductor).toHaveBeenCalledTimes(2);
    await close();
  });

  it("un traductor colgado no tumba la búsqueda: el significado y el ejemplo llegan igual", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "reluctant",
      term: "reluctant",
      pos: "adj",
      gloss: "Not wanting to do something.",
      example: "She was reluctant to answer.",
      translations: [],
    });

    // Un servicio que ni responde ni se cae. Sin el plazo del traductor, este
    // `await` no volvería nunca y la usuaria se quedaría sin la ficha entera.
    const fetchColgado = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolver, rechazar) => {
          init?.signal?.addEventListener("abort", () =>
            rechazar(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const traductor = crearTraductorMyMemory(fetchColgado as unknown as typeof fetch, 20);

    const acepciones = await traducirSiFalta(db, await buscarEnDiccionario(db, "reluctant"), traductor);

    expect(acepciones).toHaveLength(1);
    expect(acepciones[0].gloss).toBe("Not wanting to do something.");
    expect(acepciones[0].example).toBe("She was reluctant to answer.");
    expect(acepciones[0].translations).toEqual([]);
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
