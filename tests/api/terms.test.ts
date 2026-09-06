import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms } from "@/db/repository/terms";

let testDb: TestDb;

vi.mock("@/db/client", () => ({ getDb: () => testDb }));

import { PATCH, DELETE } from "@/app/api/terms/[id]/route";

function patchRequest(id: string, body: unknown) {
  return new Request(`http://localhost/api/terms/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(id: string) {
  return new Request(`http://localhost/api/terms/${id}`, { method: "DELETE" });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const base = {
  title: "Libro",
  pageStart: 1,
  pageEnd: 5,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

describe("/api/terms/[id]", () => {
  let comeAcrossId: number;
  let reluctantId: number;

  beforeEach(async () => {
    testDb = (await createTestDb()).db;
    await saveExtraction(testDb, {
      ...base,
      level: "B2",
      items: [
        {
          term: "come across",
          type: "phrasal_verb",
          translation: "encontrarse con",
          context: "I came across a photo.",
          example: "She came across an article.",
        },
        {
          term: "reluctant",
          type: "word",
          translation: "reacio",
          context: "He was reluctant to speak.",
          example: "I was reluctant to accept.",
        },
      ],
    });
    const rows = await listTerms(testDb, {});
    comeAcrossId = rows.find((r) => r.term === "come across")!.id;
    reluctantId = rows.find((r) => r.term === "reluctant")!.id;
  });

  describe("PATCH", () => {
    it("rechaza un type que no está en la lista permitida, sin tocar la base de datos", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { type: "banana" }),
        context(String(reluctantId)),
      );
      expect(response.status).toBe(400);
      const [row] = await listTerms(testDb, { search: "reluctant" });
      expect(row.type).toBe("word");
    });

    it("rechaza un level que no es del MCER", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { level: "Z9" }),
        context(String(reluctantId)),
      );
      expect(response.status).toBe(400);
      const [row] = await listTerms(testDb, { search: "reluctant" });
      expect(row.level).toBe("B2");
    });

    it("acepta una actualización parcial que solo trae translation", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { translation: "remiso" }),
        context(String(reluctantId)),
      );
      expect(response.status).toBe(200);
      const [row] = await listTerms(testDb, { search: "remiso" });
      expect(row.translation).toBe("remiso");
    });

    it("devuelve 409 (no un 500) si el término renombrado colisiona con otro ya existente", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { term: "come across" }),
        context(String(reluctantId)),
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/ya existe/i);

      // El término original no quedó a medio modificar.
      const [row] = await listTerms(testDb, { search: "reluctant" });
      expect(row.term).toBe("reluctant");
    });

    it("rechaza un id no numérico con 400 en vez de dejar pasar NaN", async () => {
      const response = await PATCH(
        patchRequest("abc", { translation: "x" }),
        context("abc"),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("rechaza un id no numérico con 400 en vez de dejar pasar NaN", async () => {
      const response = await DELETE(deleteRequest("abc"), context("abc"));
      expect(response.status).toBe(400);
      expect(await listTerms(testDb, {})).toHaveLength(2);
    });

    it("borra un término con id numérico válido", async () => {
      const response = await DELETE(
        deleteRequest(String(comeAcrossId)),
        context(String(comeAcrossId)),
      );
      expect(response.status).toBe(200);
      expect(await listTerms(testDb, {})).toHaveLength(1);
    });
  });
});
