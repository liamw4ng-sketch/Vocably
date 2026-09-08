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

/**
 * Si la consulta falla —la tabla del diccionario no existe porque nadie aplicó
 * las migraciones, por ejemplo— la ruta no puede dejar que la excepción suba:
 * Next devolvería un 500 con cuerpo HTML, el navegador reventaría al leerlo
 * como JSON, y el usuario acabaría viendo un mensaje interno del navegador.
 */
describe("cuando la base de datos falla", () => {
  it("responde 500 con un JSON que explica qué pasó", async () => {
    buscarEnBiblioteca.mockRejectedValue(
      new Error('relation "dictionary_entries" does not exist'),
    );
    buscarEnDiccionario.mockResolvedValue([]);

    const res = await pide("bank");

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const cuerpo = await res.json();
    expect(cuerpo.error).toMatch(/no se pudo buscar/i);
  });

  it("el mensaje menciona las migraciones, que es la causa más probable", async () => {
    buscarEnDiccionario.mockRejectedValue(
      new Error('relation "dictionary_entries" does not exist'),
    );
    buscarEnBiblioteca.mockResolvedValue([]);

    const cuerpo = await (await pide("bank")).json();
    expect(cuerpo.error).toMatch(/migraciones|diccionario/i);
  });
});
