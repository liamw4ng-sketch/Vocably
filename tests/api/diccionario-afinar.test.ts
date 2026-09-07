import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { dictionaryEntries } from "@/db/schema";

// vi.hoisted es necesario aquí: vi.mock se eleva por encima de este módulo,
// así que la referencia a afinarTraduccion debe elevarse con él.
const afinarTraduccion = vi.hoisted(() => vi.fn());
let testDb: TestDb;
let closeDb: () => Promise<void>;

vi.mock("@/lib/diccionario/afinar", () => ({ afinarTraduccion }));
vi.mock("@/db/client", () => ({ getDb: () => testDb }));

import { POST } from "@/app/api/diccionario/afinar/route";

function request(body: unknown) {
  return new Request("http://localhost/api/diccionario/afinar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/diccionario/afinar", () => {
  let entryId: number;

  beforeEach(async () => {
    afinarTraduccion.mockReset();
    ({ db: testDb, close: closeDb } = await createTestDb());
    const [entrada] = await testDb
      .insert(dictionaryEntries)
      .values({
        termNormalized: "reluctant",
        term: "reluctant",
        pos: "adj",
        gloss: "Not wanting to take some action.",
        translations: ["reacio"],
        translationSource: "mymemory",
      })
      .returning({ id: dictionaryEntries.id });
    entryId = entrada.id;
  });

  // Sin esto, cada prueba deja viva una instancia de PGlite.
  afterEach(async () => {
    await closeDb();
  });

  it("afina la traducción y la guarda con la fuente claude", async () => {
    afinarTraduccion.mockResolvedValue({ translations: ["reacio", "poco dispuesto"], costUsd: 0.00135 });

    const response = await POST(request({ entryId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.translations).toEqual(["reacio", "poco dispuesto"]);
    expect(afinarTraduccion).toHaveBeenCalledWith({
      term: "reluctant",
      gloss: "Not wanting to take some action.",
    });

    const [guardada] = await testDb.select().from(dictionaryEntries);
    expect(guardada.translations).toEqual(["reacio", "poco dispuesto"]);
    expect(guardada.translationSource).toBe("claude");
  });

  it("rechaza una petición sin entryId, sin llamar a Claude", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(afinarTraduccion).not.toHaveBeenCalled();
  });

  it("responde 404 si la acepción no existe", async () => {
    const response = await POST(request({ entryId: entryId + 1000 }));
    expect(response.status).toBe(404);
    expect(afinarTraduccion).not.toHaveBeenCalled();
  });

  it("devuelve 502 y un mensaje legible si la API falla", async () => {
    afinarTraduccion.mockRejectedValue(new Error("El modelo rechazó la petición para este término."));
    const response = await POST(request({ entryId }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/no se pudo afinar la traducción/i);
  });

  it("devuelve 400, y no un 500, si el cuerpo no es JSON válido", async () => {
    const response = await POST(
      new Request("http://localhost/api/diccionario/afinar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{esto no es json",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no es json válido/i);
    expect(afinarTraduccion).not.toHaveBeenCalled();
  });
});
