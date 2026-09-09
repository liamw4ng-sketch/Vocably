import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { anadirVariasDesdeDiccionario, FUENTE_DICCIONARIO } from "@/db/repository/diccionario";
import { terms, cardStates, sources, termOccurrences } from "@/db/schema";

const entrada = (term: string, gloss: string) => ({
  term, pos: "noun", gloss, example: null, translation: "algo", level: "B2",
});

describe("anadirVariasDesdeDiccionario", () => {
  it("crea todas y cuenta cuántas", async () => {
    const { db, close } = await createTestDb();

    const r = await anadirVariasDesdeDiccionario(db, [
      entrada("dog", "An animal."),
      entrada("house", "A building."),
    ]);

    expect(r).toEqual({ creadas: 2, repetidas: 0, fallidas: 0 });
    expect(await db.select().from(terms)).toHaveLength(2);
    await close();
  });

  /** Cada término gana su ficha de repaso, o no aparecería nunca en la sesión. */
  it("cada término creado gana su ficha de repaso", async () => {
    const { db, close } = await createTestDb();
    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")]);

    expect(await db.select().from(cardStates)).toHaveLength(1);
    await close();
  });

  it("lo que ya estaba no se duplica, y se cuenta aparte", async () => {
    const { db, close } = await createTestDb();
    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")]);

    const r = await anadirVariasDesdeDiccionario(db, [
      entrada("dog", "An animal."),
      entrada("cat", "Another animal."),
    ]);

    expect(r).toEqual({ creadas: 1, repetidas: 1, fallidas: 0 });
    expect(await db.select().from(terms)).toHaveLength(2);
    await close();
  });

  /**
   * Hallazgo de revisión: todo lo extraído sin IA colgaba de la fuente
   * "Diccionario", que existe justamente para distinguir lo buscado a mano de
   * lo salido de un PDF. Con la rama entera dentro, el filtro por fuente de la
   * biblioteca mezclaba las dos cosas. Una extracción tiene su fuente propia,
   * con el título y el rango que eligió el usuario, como en el camino con IA.
   */
  it("una extracción cuelga de su fuente propia, con título y rango", async () => {
    const { db, close } = await createTestDb();

    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")], {
      title: "Drácula",
      pageStart: 10,
      pageEnd: 14,
      level: "B2",
    });

    const fuentes = await db.select().from(sources);
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0].title).toBe("Drácula");
    expect(fuentes[0].pageStart).toBe(10);
    expect(fuentes[0].pageEnd).toBe(14);
    expect(fuentes[0].costUsd).toBe(0);
    await close();
  });

  it("todas las palabras del lote cuelgan de la misma fuente, no de una cada una", async () => {
    const { db, close } = await createTestDb();

    await anadirVariasDesdeDiccionario(
      db,
      [entrada("dog", "An animal."), entrada("cat", "Another animal.")],
      { title: "Drácula", pageStart: 10, pageEnd: 14, level: "B2" },
    );

    expect(await db.select().from(sources)).toHaveLength(1);
    const apariciones = await db.select().from(termOccurrences);
    expect(apariciones).toHaveLength(2);
    expect(new Set(apariciones.map((a) => a.sourceId)).size).toBe(1);
    await close();
  });

  /** El camino de la pantalla del diccionario, sin fuente, no cambia. */
  it("sin fuente sigue colgando de 'Diccionario'", async () => {
    const { db, close } = await createTestDb();
    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")]);

    const fuentes = await db.select().from(sources);
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0].title).toBe(FUENTE_DICCIONARIO);
    await close();
  });

  it("guarda la frase del libro de cada entrada como su contexto", async () => {
    const { db, close } = await createTestDb();

    await anadirVariasDesdeDiccionario(
      db,
      [{ ...entrada("dog", "An animal."), context: "The dog barked all night." }],
      { title: "Drácula", pageStart: 10, pageEnd: 14, level: "B2" },
    );

    const [aparicion] = await db.select().from(termOccurrences);
    expect(aparicion.context).toBe("The dog barked all night.");
    await close();
  });

  it("con la lista vacía no crea nada", async () => {
    const { db, close } = await createTestDb();
    expect(await anadirVariasDesdeDiccionario(db, [])).toEqual({ creadas: 0, repetidas: 0, fallidas: 0 });
    await close();
  });

  /**
   * Postgres rechaza el byte nulo dentro de un campo de texto: es una forma
   * realista de hacer fallar una sola inserción sin tocar nada más. La
   * entrada a mitad de lote falla; las de después no deben saltarse.
   */
  it("una entrada que falla no aborta las siguientes, y el fallo se cuenta", async () => {
    const { db, close } = await createTestDb();

    const r = await anadirVariasDesdeDiccionario(db, [
      entrada("uno", "Primera."),
      entrada("dos", "Segunda."),
      entrada("tres\0malo", "Tiene un byte nulo: Postgres rechaza esta fila."),
      entrada("cuatro", "Cuarta."),
      entrada("cinco", "Quinta."),
    ]);

    expect(r).toEqual({ creadas: 4, repetidas: 0, fallidas: 1 });

    // Las dos palabras posteriores a la que falla sí se guardaron: el fallo
    // de una entrada no aborta el resto del lote.
    const guardados = await db.select({ term: terms.term }).from(terms);
    expect(guardados.map((t) => t.term).sort()).toEqual(["cinco", "cuatro", "dos", "uno"]);
    await close();
  });
});
