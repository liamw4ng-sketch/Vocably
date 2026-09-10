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
  /** 0 es "sin tope": el freno de nuevas viene apagado. */
  it("devuelve el tope apagado por defecto", async () => {
    const res = await GET();
    expect((await res.json()).newCardsPerDay).toBe(0);
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

  it("devuelve los repasos por sesión, 0 (sin límite) por defecto", async () => {
    expect((await (await GET()).json()).sessionSize).toBe(0);
  });

  it("cambia los repasos por sesión y los persiste", async () => {
    expect((await PATCH(patch({ sessionSize: 30 }))).status).toBe(200);
    expect((await (await GET()).json()).sessionSize).toBe(30);
  });

  it("cambiar un ajuste no pisa el otro", async () => {
    await PATCH(patch({ newCardsPerDay: 7 }));
    await PATCH(patch({ sessionSize: 30 }));
    const body = await (await GET()).json();
    expect(body).toMatchObject({ newCardsPerDay: 7, sessionSize: 30 });
  });

  it("acepta los dos ajustes en la misma petición", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 3, sessionSize: 12 }))).status).toBe(200);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ newCardsPerDay: 3, sessionSize: 12 });
  });

  it("rechaza unos repasos por sesión no enteros, negativos o absurdos", async () => {
    expect((await PATCH(patch({ sessionSize: 0.5 }))).status).toBe(400);
    expect((await PATCH(patch({ sessionSize: -1 }))).status).toBe(400);
    expect((await PATCH(patch({ sessionSize: 9999 }))).status).toBe(400);
  });

  it("devuelve el modo de sesión, 'mezcla' por defecto", async () => {
    expect((await (await GET()).json()).sessionMode).toBe("mezcla");
  });

  it("cambia el modo de sesión y lo persiste", async () => {
    // Es el ajuste que escribe "Recordar esta elección", y no tenía ni una
    // prueba: ni el guardián `esModo` ni su mensaje de error se ejercitaban.
    expect((await PATCH(patch({ sessionMode: "aprendidas" }))).status).toBe(200);
    expect((await (await GET()).json()).sessionMode).toBe("aprendidas");
  });

  it("rechaza un modo que no existe, y lo dice en español", async () => {
    const res = await PATCH(patch({ sessionMode: "todas" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "El modo de sesión debe ser uno de: no-aprendidas, aprendidas, mezcla.",
    );
    // Y no ha guardado nada por el camino.
    expect((await (await GET()).json()).sessionMode).toBe("mezcla");
  });

  it("guarda modo y número en la misma petición: es lo que hace 'Recordar esta elección'", async () => {
    expect((await PATCH(patch({ sessionSize: 25, sessionMode: "no-aprendidas" }))).status).toBe(200);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ sessionSize: 25, sessionMode: "no-aprendidas" });
  });

  it("rechaza un cuerpo que no trae ningún ajuste", async () => {
    // Sin esto, un error de nombre en el cliente devolvería 200 y no
    // guardaría nada: el usuario vería el campo aceptado y el valor perdido.
    expect((await PATCH(patch({}))).status).toBe(400);
    expect((await PATCH(patch({ topeDiario: 5 }))).status).toBe(400);
  });
});