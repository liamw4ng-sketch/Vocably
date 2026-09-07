import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { GET, PATCH } from "@/app/api/ajustes/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

function patch(body: unknown) {
  return new Request("http://localhost/api/ajustes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/ajustes", () => {
  it("devuelve 20 por defecto", async () => {
    const res = await GET();
    expect((await res.json()).newCardsPerDay).toBe(20);
  });

  it("cambia el tope y lo persiste", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 5 }))).status).toBe(200);
    expect((await (await GET()).json()).newCardsPerDay).toBe(5);
  });

  it("acepta 0: dejar de introducir palabras nuevas es legítimo", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 0 }))).status).toBe(200);
    expect((await (await GET()).json()).newCardsPerDay).toBe(0);
  });

  it("rechaza un valor no entero", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 0.5 }))).status).toBe(400);
  });

  it("rechaza un valor negativo", async () => {
    expect((await PATCH(patch({ newCardsPerDay: -1 }))).status).toBe(400);
  });

  it("rechaza un valor absurdamente alto", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 999 }))).status).toBe(400);
  });

  it("rechaza un cuerpo mal formado", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/ajustes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{roto",
      }),
    );
    expect(res.status).toBe(400);
  });
});
