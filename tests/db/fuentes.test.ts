import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms, renombrarFuente } from "@/db/repository/terms";

let db: TestDb;
let closeDb: () => Promise<void>;

const base = { pageStart: 1, pageEnd: 5, level: "B2", inputTokens: 0, outputTokens: 0, costUsd: 0 };

function termino(n: number) {
  return {
    term: `palabra${n}`,
    type: "word" as const,
    translation: `traducción${n}`,
    context: `Frase con palabra${n}.`,
    example: `Ejemplo con palabra${n}.`,
  };
}

beforeEach(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterEach(async () => {
  await closeDb();
});

const fuentesDe = async (busqueda = {}) =>
  (await listTerms(db, busqueda)).flatMap((t) => t.sources);

describe("renombrarFuente", () => {
  /**
   * Lo pidió en la biblioteca: «fake_news.pdf, si las palabras asociadas a ese
   * documento quiero cambiar el nombre por ejemplo a simplemente fake».
   */
  it("cambia el nombre y las palabras se quedan donde estaban", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });

    expect(await renombrarFuente(db, "fake_news.pdf", "fake")).toBe(1);

    expect(await fuentesDe()).toEqual(["fake"]);
    expect(await listTerms(db, { source: "fake" })).toHaveLength(1);
  });

  /**
   * El mismo documento extraído dos veces son dos filas de `sources` con el
   * mismo título: para él es un documento, así que se renombran las dos. Sin
   * esto, la mitad de sus palabras se quedaría con el nombre viejo.
   */
  it("renombra todas las extracciones que compartían ese título", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });
    await saveExtraction(db, {
      ...base,
      title: "fake_news.pdf",
      pageStart: 6,
      pageEnd: 9,
      items: [termino(2)],
    });

    expect(await renombrarFuente(db, "fake_news.pdf", "fake")).toBe(2);
    expect(await listTerms(db, { source: "fake" })).toHaveLength(2);
  });

  it("no toca las demás fuentes", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });
    await saveExtraction(db, { ...base, title: "Otro libro", items: [termino(2)] });

    await renombrarFuente(db, "fake_news.pdf", "fake");

    expect(await listTerms(db, { source: "Otro libro" })).toHaveLength(1);
  });

  /** Recorta los espacios: un nombre con espacio final no se puede volver a filtrar. */
  it("recorta el nombre nuevo", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });

    await renombrarFuente(db, "fake_news.pdf", "  fake  ");

    expect(await fuentesDe()).toEqual(["fake"]);
  });

  /** Fundir dos documentos en un nombre es una operación válida, no un error. */
  it("permite darle el nombre de otra fuente que ya existe: se funden", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });
    await saveExtraction(db, { ...base, title: "fake", items: [termino(2)] });

    await renombrarFuente(db, "fake_news.pdf", "fake");

    expect(await listTerms(db, { source: "fake" })).toHaveLength(2);
  });

  it("un título que no existe no cambia nada y lo dice con un cero", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });

    expect(await renombrarFuente(db, "no existe", "fake")).toBe(0);
    expect(await fuentesDe()).toEqual(["fake_news.pdf"]);
  });

  /** Sin nombre, la fuente desaparecería del filtro y sus palabras con ella. */
  it("rechaza un nombre vacío", async () => {
    await saveExtraction(db, { ...base, title: "fake_news.pdf", items: [termino(1)] });

    await expect(renombrarFuente(db, "fake_news.pdf", "   ")).rejects.toThrow(
      /nombre/i,
    );
    expect(await fuentesDe()).toEqual(["fake_news.pdf"]);
  });
});
