import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { anadirVariasDesdeDiccionario } from "@/db/repository/diccionario";
import { terms, cardStates } from "@/db/schema";

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
