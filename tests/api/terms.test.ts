import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms } from "@/db/repository/terms";
import { terms } from "@/db/schema";

let testDb: TestDb;
let closeDb: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => testDb }));

import { PATCH, DELETE } from "@/app/api/terms/[id]/route";
import { POST } from "@/app/api/terms/route";

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
    ({ db: testDb, close: closeDb } = await createTestDb());
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

  // Sin esto, cada prueba deja viva una instancia de PGlite.
  afterEach(async () => {
    await closeDb();
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

    it("rechaza un término vacío, que dejaría la clave de deduplicación en blanco", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { term: "   " }),
        context(String(reluctantId)),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/no puede quedar vacío/i);
      const [row] = await listTerms(testDb, { search: "reluctant" });
      expect(row.term).toBe("reluctant");
    });

    it("rechaza una traducción vacía", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { translation: "" }),
        context(String(reluctantId)),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/no puede quedar vacío/i);
      const [row] = await listTerms(testDb, { search: "reluctant" });
      expect(row.translation).toBe("reacio");
    });

    it("rechaza un término que no es una cadena", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { term: 42 }),
        context(String(reluctantId)),
      );
      expect(response.status).toBe(400);
    });

    it("ignora las claves que no son editables en vez de colarlas en el UPDATE", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), {
          translation: "remiso",
          termNormalized: "clave falsificada",
          id: 9999,
          createdAt: "1970-01-01",
        }),
        context(String(reluctantId)),
      );

      expect(response.status).toBe(200);
      const saved = await testDb.select().from(terms);
      const row = saved.find((r) => r.id === reluctantId)!;
      expect(row.translation).toBe("remiso");
      expect(row.termNormalized).toBe("reluctant");
      expect(row.id).toBe(reluctantId);
    });

    it("recorta los espacios del término y recalcula su clave de deduplicación", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), { term: "  Reluctant  " }),
        context(String(reluctantId)),
      );

      expect(response.status).toBe(200);
      const saved = await testDb.select().from(terms);
      const row = saved.find((r) => r.id === reluctantId)!;
      expect(row.term).toBe("Reluctant");
      expect(row.termNormalized).toBe("reluctant");
    });

    it("devuelve 400, y no un 500, si el cuerpo no es JSON válido", async () => {
      const response = await PATCH(
        new Request(`http://localhost/api/terms/${reluctantId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{esto no es json",
        }),
        context(String(reluctantId)),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/no es json válido/i);
    });

    it("rechaza un cuerpo que no es un objeto", async () => {
      const response = await PATCH(
        patchRequest(String(reluctantId), ["term", "otro"]),
        context(String(reluctantId)),
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

function postRequest(body: unknown) {
  return new Request("http://localhost/api/terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/terms", () => {
  beforeEach(async () => {
    ({ db: testDb, close: closeDb } = await createTestDb());
  });

  afterEach(async () => {
    await closeDb();
  });

  it("guarda la acepción y responde 201", async () => {
    const res = await POST(
      postRequest({
        term: "bank",
        pos: "noun",
        gloss: "An edge of a river.",
        example: "We sat on the bank.",
        translation: "orilla",
        level: "B1",
      }),
    );
    expect(res.status).toBe(201);
    const [row] = await listTerms(testDb, {});
    expect(row.term).toBe("bank");
    expect(row.translation).toBe("orilla");
  });

  it("sin nivel responde 400 y no guarda nada", async () => {
    const res = await POST(
      postRequest({ term: "bank", pos: "noun", gloss: "x", translation: "orilla" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("nivel");
    expect(await listTerms(testDb, {})).toHaveLength(0);
  });
});
