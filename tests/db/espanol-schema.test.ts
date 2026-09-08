import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { spanishMeanings } from "@/db/schema";

describe("spanish_meanings", () => {
  it("guarda una palabra con su categoría y sus significados", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "language",
      term: "language",
      pos: "noun",
      meanings: ["Idioma.", "Lengua, lenguaje."],
      source: "wikcionario-es",
    });

    const [fila] = await db.select().from(spanishMeanings);
    expect(fila.term).toBe("language");
    expect(fila.meanings).toEqual(["Idioma.", "Lengua, lenguaje."]);
    expect(fila.source).toBe("wikcionario-es");
    await close();
  });

  /**
   * La misma palabra en dos categorías son dos filas: `dog` sustantivo no
   * significa lo mismo que `dog` verbo.
   */
  it("deja la misma palabra en dos categorías distintas", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
      { termNormalized: "dog", term: "dog", pos: "verb", meanings: ["Acosar."], source: "wikcionario-es" },
    ]);

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });

  /**
   * El único es lo que hace que volver a cargar el volcado actualice en vez de
   * duplicar. Sin él, cada carga añadiría 21.000 filas más.
   */
  it("rechaza la misma palabra y categoría dos veces", async () => {
    const { db, close } = await createTestDb();
    const fila = {
      termNormalized: "dog",
      term: "dog",
      pos: "noun",
      meanings: ["Perro."],
      source: "wikcionario-es",
    };
    await db.insert(spanishMeanings).values(fila);

    await expect(db.insert(spanishMeanings).values(fila)).rejects.toThrow();
    await close();
  });

  /**
   * MyMemory traduce la palabra sin decir de qué categoría habla, así que sus
   * filas ocupan la categoría vacía y nunca chocan con las de Wikcionario.
   */
  it("la categoría vacía de MyMemory convive con la de Wikcionario", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "turn down", term: "turn down", pos: "verb", meanings: ["Rechazar."], source: "wikcionario-es" },
      { termNormalized: "turn down", term: "turn down", pos: "", meanings: ["rechazar"], source: "mymemory" },
    ]);

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });
});
