import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarEspanol, ORIGEN_MYMEMORY, ORIGEN_WIKCIONARIO_ES } from "@/db/repository/espanol";
import { spanishMeanings } from "@/db/schema";

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
});
