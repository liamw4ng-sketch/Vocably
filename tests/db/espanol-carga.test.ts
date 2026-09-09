import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarEspanol, ORIGEN_MYMEMORY, ORIGEN_WIKCIONARIO_ES } from "@/db/repository/espanol";
import { spanishMeanings } from "@/db/schema";
import { MAXIMO_SIGNIFICADOS_GUARDADOS } from "@/lib/diccionario/espanol";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

const language = JSON.stringify({ w: "language", p: "noun", s: ["Idioma.", "Lengua, lenguaje."] });
const dogSustantivo = JSON.stringify({ w: "dog", p: "noun", s: ["Perro."] });
const dogVerbo = JSON.stringify({ w: "dog", p: "verb", s: ["Acosar."] });

describe("cargarEspanol", () => {
  it("guarda una fila por palabra y categoría, marcada con su origen", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarEspanol(db, lineasDe(language, dogSustantivo, dogVerbo));

    expect(resultado).toEqual({ entradas: 3 });
    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.source === ORIGEN_WIKCIONARIO_ES)).toBe(true);
    await close();
  });

  it("salta las líneas que no sirven sin abortar la carga", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarEspanol(db, lineasDe(language, "{ roto", "", dogSustantivo));

    expect(resultado).toEqual({ entradas: 2 });
    await close();
  });

  it("recargar el mismo fichero no duplica: actualiza", async () => {
    const { db, close } = await createTestDb();
    await cargarEspanol(db, lineasDe(language));
    await cargarEspanol(db, lineasDe(JSON.stringify({ w: "language", p: "noun", s: ["Idioma.", "Otro."] })));

    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(1);
    expect(filas[0].meanings).toEqual(["Idioma.", "Otro."]);
    await close();
  });

  /**
   * Lo que trajo MyMemory es cuota ya gastada y vive en la categoría vacía.
   * Una carga del volcado no puede llevárselo por delante: si lo hiciera, cada
   * recarga del diccionario obligaría a volver a pagar en caracteres.
   */
  it("no toca las filas de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "turn down",
      term: "turn down",
      pos: "",
      meanings: ["rechazar"],
      source: ORIGEN_MYMEMORY,
    });

    await cargarEspanol(db, lineasDe(JSON.stringify({ w: "turn down", p: "verb", s: ["Rechazar."] })));

    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(2);
    const deMyMemory = filas.find((f) => f.source === ORIGEN_MYMEMORY);
    expect(deMyMemory?.meanings).toEqual(["rechazar"]);
    await close();
  });

  it("escribe por lotes sin perder ninguna entrada", async () => {
    const { db, close } = await createTestDb();
    const muchas = Array.from({ length: 7 }, (_, i) =>
      JSON.stringify({ w: `palabra${i}`, p: "noun", s: [`Significado ${i}.`] }),
    );

    const resultado = await cargarEspanol(db, lineasDe(...muchas), { tamanoLote: 2 });

    expect(resultado).toEqual({ entradas: 7 });
    expect(await db.select().from(spanishMeanings)).toHaveLength(7);
    await close();
  });

  /**
   * Caso real del volcado: `frog` como sustantivo aparece tres veces porque son
   * tres etimologías distintas, cada una con su propio significado en español
   * ("Rana.", "Francés.", "Camino, calle, carretera."). El volcado viene
   * ordenado por palabra, así que las repeticiones caen en el mismo lote de
   * 500 y `ON CONFLICT DO UPDATE` no soporta tocar la misma fila dos veces en
   * la misma sentencia: sin fusionar, la carga entera revienta.
   */
  it("dos líneas con la misma palabra y categoría en el mismo lote no revientan la carga, y dejan una fila", async () => {
    const { db, close } = await createTestDb();
    const rana = JSON.stringify({ w: "frog", p: "noun", s: ["Rana."] });
    const frances = JSON.stringify({ w: "frog", p: "noun", s: ["Francés."] });

    const resultado = await cargarEspanol(db, lineasDe(rana, frances), { tamanoLote: 10 });

    expect(resultado).toEqual({ entradas: 1 });
    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(1);
    await close();
  });

  it("fusiona los significados de las líneas repetidas, en orden y sin repetidos exactos, en vez de descartar", async () => {
    const { db, close } = await createTestDb();
    const rana = JSON.stringify({ w: "frog", p: "noun", s: ["Rana.", "Ranilla."] });
    const frances = JSON.stringify({ w: "frog", p: "noun", s: ["Francés."] });
    const camino = JSON.stringify({ w: "frog", p: "noun", s: ["Francés.", "Camino, calle, carretera."] });

    const resultado = await cargarEspanol(db, lineasDe(rana, frances, camino), { tamanoLote: 10 });

    expect(resultado).toEqual({ entradas: 1 });
    const [fila] = await db.select().from(spanishMeanings);
    // "Francés." aparece en dos entradas pero solo debe quedar una vez, y el
    // orden de llegada se conserva; nada se descarta salvo el repetido exacto.
    expect(fila.meanings).toEqual(["Rana.", "Ranilla.", "Francés.", "Camino, calle, carretera."]);
    expect(fila.term).toBe("frog");
    await close();
  });

  /**
   * Hallazgo D: el comentario de `fusionarLote` decía que "el volcado viene
   * ordenado por palabra, así que las repeticiones caen siempre en el mismo
   * lote", pero un corte de lote puede caer justo en medio de un grupo de
   * etimologías repetidas. Cuando eso pasa, la segunda mitad llega en su
   * propio `INSERT ... ON CONFLICT DO UPDATE` con `meanings = excluded.meanings`
   * y pisa en silencio lo que la primera mitad ya había fusionado: se pierde
   * "Rana." sin ningún aviso.
   */
  it("un corte de lote a mitad de una clave repetida no pierde los significados de la primera mitad", async () => {
    const { db, close } = await createTestDb();
    const relleno = JSON.stringify({ w: "cat", p: "noun", s: ["Gato."] });
    const rana = JSON.stringify({ w: "frog", p: "noun", s: ["Rana."] });
    const frances = JSON.stringify({ w: "frog", p: "noun", s: ["Francés."] });

    // tamanoLote 2: sin el arreglo, el lote se cierra justo tras "relleno" +
    // "rana" (ya son dos), y "francés" cae en el lote siguiente.
    const resultado = await cargarEspanol(db, lineasDe(relleno, rana, frances), { tamanoLote: 2 });

    expect(resultado).toEqual({ entradas: 2 });
    const filas = await db.select().from(spanishMeanings);
    const frog = filas.find((f) => f.term === "frog");
    expect(frog?.meanings).toEqual(["Rana.", "Francés."]);
    await close();
  });

  it("recorta a MAXIMO_SIGNIFICADOS_GUARDADOS después de fusionar, no antes", async () => {
    const { db, close } = await createTestDb();
    const primeraMitad = JSON.stringify({
      w: "frog",
      p: "noun",
      s: ["Significado 1.", "Significado 2.", "Significado 3.", "Significado 4.", "Significado 5."],
    });
    const segundaMitad = JSON.stringify({
      w: "frog",
      p: "noun",
      s: ["Significado 6.", "Significado 7.", "Significado 8.", "Significado 9."],
    });

    await cargarEspanol(db, lineasDe(primeraMitad, segundaMitad), { tamanoLote: 10 });

    const [fila] = await db.select().from(spanishMeanings);
    expect(fila.meanings).toHaveLength(MAXIMO_SIGNIFICADOS_GUARDADOS);
    expect(fila.meanings).toEqual([
      "Significado 1.",
      "Significado 2.",
      "Significado 3.",
      "Significado 4.",
      "Significado 5.",
      "Significado 6.",
      "Significado 7.",
      "Significado 8.",
    ]);
    await close();
  });
});
