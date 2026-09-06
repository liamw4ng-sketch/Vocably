import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { GET } from "@/app/api/repaso/cola/route";
import { POST } from "@/app/api/repaso/respuesta/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
  await saveExtraction(db, {
    title: "Libro",
    pageStart: 1,
    pageEnd: 5,
    level: "B2",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    items: [
      {
        term: "come across",
        type: "phrasal_verb",
        translation: "encontrarse con",
        context: "I came across a photo.",
        example: "She came across an article.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

function post(body: unknown) {
  return new Request("http://localhost/api/repaso/respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/repaso/cola", () => {
  it("devuelve las cartas del día", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cartas).toHaveLength(1);
    expect(body.cartas[0].term).toBe("come across");
  });

  it("acepta filtros por tipo", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola?type=word"));
    expect((await res.json()).cartas).toHaveLength(0);
  });
});

describe("POST /api/repaso/respuesta", () => {
  it("registra una valoración", async () => {
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aplicada).toBe(true);
  });

  it("no permite que el cliente fije la fecha o el estado de la tarjeta", async () => {
    // El cuerpo trae campos que un cliente malicioso o con prisa podría enviar
    // para intentar controlar el resultado directamente. El servidor debe
    // ignorarlos por completo y calcular `now` con `new Date()`.
    const res = await POST(
      post({
        answerId: "a-extra",
        termId: 1,
        rating: 1,
        now: "2000-01-01T00:00:00.000Z",
        state: "Review",
        due: "2099-01-01T00:00:00.000Z",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aplicada).toBe(true);
    // Con rating 1 (Again) la próxima fecha siempre está muy cerca de ahora;
    // si el servidor hubiera honrado un `now`/`due` inventado del año 2000 o
    // 2099, esta comprobación fallaría.
    const proximaFecha = new Date(body.proximaFecha);
    const diffMinutos = Math.abs(proximaFecha.getTime() - Date.now()) / 60000;
    expect(diffMinutos).toBeLessThan(60);
  });

  it("una respuesta repetida responde 200 pero no la aplica dos veces", async () => {
    await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    expect(res.status).toBe(200);
    expect((await res.json()).aplicada).toBe(false);
  });

  it("rechaza una valoración fuera de 1..4", async () => {
    const res = await POST(post({ answerId: "b", termId: 1, rating: 7 }));
    expect(res.status).toBe(400);
  });

  it("rechaza una valoración que no es un número", async () => {
    const res = await POST(post({ answerId: "b2", termId: 1, rating: "3" }));
    expect(res.status).toBe(400);
  });

  it("rechaza un término que no es un número", async () => {
    const res = await POST(post({ answerId: "c", termId: "1", rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza una petición sin identificador de respuesta", async () => {
    const res = await POST(post({ termId: 1, rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza un identificador de respuesta vacío", async () => {
    const res = await POST(post({ answerId: "   ", termId: 1, rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza un cuerpo mal formado", async () => {
    const res = await POST(
      new Request("http://localhost/api/repaso/respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{no es json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
