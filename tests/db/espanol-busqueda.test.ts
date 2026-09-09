import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import {
  buscarSignificadosEspanoles,
  completarConTraductor,
  ORIGEN_MYMEMORY,
  ORIGEN_WIKCIONARIO_ES,
} from "@/db/repository/espanol";
import { spanishMeanings } from "@/db/schema";

describe("buscarSignificadosEspanoles", () => {
  it("devuelve los significados de la palabra, por categoría", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "verb", meanings: ["Acosar."], source: ORIGEN_WIKCIONARIO_ES },
    ]);

    const encontrados = await buscarSignificadosEspanoles(db, "dog");

    expect(encontrados).toHaveLength(2);
    expect(encontrados.map((s) => s.pos).sort()).toEqual(["noun", "verb"]);
    await close();
  });

  it("no devuelve nada de una palabra que no está", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarSignificadosEspanoles(db, "xyzzy")).toEqual([]);
    await close();
  });

  it("busca con la clave normalizada", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "come across", term: "come across", pos: "verb",
      meanings: ["Encontrarse."], source: ORIGEN_WIKCIONARIO_ES,
    });

    expect(await buscarSignificadosEspanoles(db, "  Come   Across ")).toHaveLength(1);
    await close();
  });

  /**
   * Wikcionario lematiza los idioms con "one" y la gente los escribe con "you".
   * La misma regla que ya usa la búsqueda del diccionario inglés.
   */
  it("prueba las variantes del lema", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "bite off more than one can chew", term: "bite off more than one can chew",
      pos: "verb", meanings: ["Abarcar más de lo que se puede."], source: ORIGEN_WIKCIONARIO_ES,
    });

    const encontrados = await buscarSignificadosEspanoles(db, "bite off more than you can chew");
    expect(encontrados).toHaveLength(1);
    await close();
  });

  /**
   * Teniendo el diccionario, la traducción automática sobra en pantalla: decir
   * las dos cosas a la vez es ruido, y la escrita por personas es mejor.
   */
  it("con Wikcionario delante, no devuelve lo de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "", meanings: ["perro"], source: ORIGEN_MYMEMORY },
    ]);

    const encontrados = await buscarSignificadosEspanoles(db, "dog");

    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].source).toBe(ORIGEN_WIKCIONARIO_ES);
    await close();
  });

  it("pero sin Wikcionario, sí devuelve lo de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "turn down", term: "turn down", pos: "",
      meanings: ["rechazar"], source: ORIGEN_MYMEMORY,
    });

    const encontrados = await buscarSignificadosEspanoles(db, "turn down");

    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].source).toBe(ORIGEN_MYMEMORY);
    await close();
  });

  it("la fila de MyMemory descartada sigue en la base", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "", meanings: ["perro"], source: ORIGEN_MYMEMORY },
    ]);

    await buscarSignificadosEspanoles(db, "dog");

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });
});

describe("completarConTraductor", () => {
  it("no llama al traductor si ya hay significados", async () => {
    const { db, close } = await createTestDb();
    const encontrados = [
      { term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
    ];
    const traductor = vi.fn(async () => ["perro"]);

    const resultado = await completarConTraductor(db, "dog", encontrados, traductor);

    expect(traductor).not.toHaveBeenCalled();
    expect(resultado).toEqual(encontrados);
    await close();
  });

  it("traduce lo que falta y lo devuelve como grupo sin categoría", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar", "denegar"]);

    const resultado = await completarConTraductor(db, "turn down", [], traductor);

    expect(traductor).toHaveBeenCalledExactlyOnceWith("turn down");
    expect(resultado).toEqual([
      { term: "turn down", pos: "", meanings: ["rechazar", "denegar"], source: ORIGEN_MYMEMORY },
    ]);
    await close();
  });

  /**
   * El fallo que esto arregla. Antes solo se guardaba si a la palabra le
   * faltaba el español en **una única** acepción, cosa que casi nunca pasa: por
   * eso las 267.014 filas del diccionario tenían la fuente a nulo y cada
   * búsqueda volvía a gastar cuota. Ahora el dato tiene su nivel y se guarda
   * siempre.
   */
  it("guarda lo traducido: la segunda búsqueda ya no gasta cuota", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar"]);

    await completarConTraductor(db, "turn down", [], traductor);
    const segunda = await completarConTraductor(
      db,
      "turn down",
      await buscarSignificadosEspanoles(db, "turn down"),
      traductor,
    );

    expect(traductor).toHaveBeenCalledTimes(1);
    expect(segunda[0].meanings).toEqual(["rechazar"]);
    await close();
  });

  it("si el traductor no devuelve nada, no guarda nada y la palabra se queda sin español", async () => {
    const { db, close } = await createTestDb();

    const resultado = await completarConTraductor(db, "xyzzy", [], async () => []);

    expect(resultado).toEqual([]);
    expect(await db.select().from(spanishMeanings)).toHaveLength(0);
    await close();
  });

  /**
   * Guardar con la clave normalizada, no con lo que se escribió: si no, buscar
   * "Turn Down" crearía una fila distinta y la cuota se gastaría dos veces.
   */
  it("guarda con la clave normalizada", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar"]);

    await completarConTraductor(db, "  Turn   Down ", [], traductor);
    await completarConTraductor(
      db,
      "turn down",
      await buscarSignificadosEspanoles(db, "turn down"),
      traductor,
    );

    expect(traductor).toHaveBeenCalledTimes(1);
    await close();
  });
});
