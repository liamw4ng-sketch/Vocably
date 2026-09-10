import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms } from "@/db/repository/terms";
import { MAXIMO_NOMBRE_DE_FUENTE } from "@/lib/fuentes";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { PATCH } from "@/app/api/fuentes/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
  await saveExtraction(db, {
    title: "fake_news.pdf",
    pageStart: 1,
    pageEnd: 5,
    level: "B2",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    items: [
      {
        term: "palabra1",
        type: "word",
        translation: "traducción1",
        context: "Frase con palabra1.",
        example: "Ejemplo con palabra1.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

function patch(body: unknown) {
  return new Request("http://localhost/api/fuentes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/fuentes", () => {
  it("renombra la fuente y lo dice", async () => {
    const res = await PATCH(patch({ titulo: "fake_news.pdf", nuevoTitulo: "fake" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ titulo: "fake", renombradas: 1 });
    expect(await listTerms(db, { source: "fake" })).toHaveLength(1);
  });

  it("recorta los espacios del nombre nuevo", async () => {
    const res = await PATCH(patch({ titulo: "fake_news.pdf", nuevoTitulo: "  fake  " }));

    expect((await res.json()).titulo).toBe("fake");
  });

  it("un nombre vacío se rechaza y no toca nada", async () => {
    const res = await PATCH(patch({ titulo: "fake_news.pdf", nuevoTitulo: "   " }));

    expect(res.status).toBe(400);
    expect(await listTerms(db, { source: "fake_news.pdf" })).toHaveLength(1);
  });

  it("un nombre larguísimo se rechaza", async () => {
    const largo = "x".repeat(MAXIMO_NOMBRE_DE_FUENTE + 1);
    expect((await PATCH(patch({ titulo: "fake_news.pdf", nuevoTitulo: largo }))).status).toBe(400);
  });

  /**
   * 404 y no 200: si ese título ya no existe, el cliente está mirando una lista
   * vieja. Responder que sí se ha renombrado dejaría al usuario creyendo que el
   * cambio se hizo.
   */
  it("una fuente que no existe da 404", async () => {
    const res = await PATCH(patch({ titulo: "no existe", nuevoTitulo: "fake" }));

    expect(res.status).toBe(404);
  });

  it("sin los dos títulos, 400", async () => {
    expect((await PATCH(patch({ titulo: "fake_news.pdf" }))).status).toBe(400);
    expect((await PATCH(patch({ nuevoTitulo: "fake" }))).status).toBe(400);
  });

  it("un cuerpo que no es JSON da 400 y no revienta", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/fuentes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{no es json",
      }),
    );

    expect(res.status).toBe(400);
  });
});
