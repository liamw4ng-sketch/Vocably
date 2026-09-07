import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { valor: null as unknown };
vi.mock("@/db/client", () => ({ getDb: () => db.valor }));

const buscarEnDiccionario = vi.fn();
const buscarEnBiblioteca = vi.fn();
const traducirSiFalta = vi.fn(async (_db: unknown, acepciones: unknown) => acepciones);
vi.mock("@/db/repository/diccionario", () => ({
  buscarEnDiccionario: (...args: unknown[]) => buscarEnDiccionario(...args),
  buscarEnBiblioteca: (...args: unknown[]) => buscarEnBiblioteca(...args),
  traducirSiFalta: (db: unknown, acepciones: unknown) => traducirSiFalta(db, acepciones),
}));

const { GET } = await import("@/app/api/diccionario/route");

beforeEach(() => {
  buscarEnDiccionario.mockReset();
  buscarEnBiblioteca.mockReset();
});

const pide = (q: string) => GET(new Request(`http://localhost/api/diccionario?q=${encodeURIComponent(q)}`));

describe("GET /api/diccionario", () => {
  it("una búsqueda vacía responde 400 sin consultar nada", async () => {
    const res = await pide("   ");
    expect(res.status).toBe(400);
    expect(buscarEnDiccionario).not.toHaveBeenCalled();
  });

  it("marca la acepción que ya está en la biblioteca", async () => {
    buscarEnBiblioteca.mockResolvedValue([
      { id: 7, term: "bank", translation: "orilla", level: "B1", senseHint: "An edge of a river." },
    ]);
    buscarEnDiccionario.mockResolvedValue([
      { id: 1, term: "bank", pos: "noun", gloss: "An edge of a river.", example: null, translations: [] },
      { id: 2, term: "bank", pos: "noun", gloss: "A financial institution.", example: null, translations: [] },
    ]);

    const cuerpo = await (await pide("bank")).json();
    expect(cuerpo.acepciones[0].yaGuardada).toBe(true);
    expect(cuerpo.acepciones[1].yaGuardada).toBe(false);
    expect(cuerpo.enBiblioteca).toHaveLength(1);
  });

  it("un término desconocido responde 200 con las listas vacías", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);

    const res = await pide("xyzzy");
    expect(res.status).toBe(200);
    expect((await res.json()).acepciones).toEqual([]);
  });
});
