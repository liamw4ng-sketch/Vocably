import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { valor: null as unknown };
vi.mock("@/db/client", () => ({ getDb: () => db.valor }));

const buscarSugerencias = vi.fn();
vi.mock("@/db/repository/extraer", () => ({
  buscarSugerencias: (...args: unknown[]) => buscarSugerencias(...args),
}));

const { POST } = await import("@/app/api/extraer-sin-ia/route");

beforeEach(() => {
  buscarSugerencias.mockReset();
  buscarSugerencias.mockResolvedValue([]);
});

const pide = (cuerpo: unknown) =>
  POST(
    new Request("http://localhost/api/extraer-sin-ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
  );

const candidata = { texto: "abandon", frase: "He abandoned it." };

describe("POST /api/extraer-sin-ia", () => {
  it("devuelve las sugerencias que da el repositorio", async () => {
    buscarSugerencias.mockResolvedValue([
      { term: "abandon", pos: "verb", gloss: "To leave.", example: null,
        frase: "He abandoned it.", significados: ["Abandonar."], nivel: "B2", tipo: "word" },
    ]);

    const cuerpo = await (await pide({ candidatas: [candidata], suelo: "B2" })).json();

    expect(cuerpo.sugerencias).toHaveLength(1);
    expect(cuerpo.sugerencias[0].term).toBe("abandon");
  });

  it("le pasa al repositorio el suelo que se le pide", async () => {
    await pide({ candidatas: [candidata], suelo: "C1" });
    expect(buscarSugerencias.mock.calls[0][2]).toBe("C1");
  });

  it("sin candidatas responde 400 sin consultar nada", async () => {
    const res = await pide({ candidatas: [], suelo: "B2" });
    expect(res.status).toBe(400);
    expect(buscarSugerencias).not.toHaveBeenCalled();
  });

  it("con un suelo que no es un nivel responde 400", async () => {
    const res = await pide({ candidatas: [candidata], suelo: "Z9" });
    expect(res.status).toBe(400);
    expect(buscarSugerencias).not.toHaveBeenCalled();
  });

  it("con un cuerpo que no es JSON responde 400 y no revienta", async () => {
    const res = await POST(
      new Request("http://localhost/api/extraer-sin-ia", { method: "POST", body: "{roto" }),
    );
    expect(res.status).toBe(400);
  });

  it("descarta las candidatas mal formadas en vez de tumbar la petición", async () => {
    await pide({ candidatas: [candidata, { texto: 42 }, null, { frase: "sin texto" }], suelo: "B2" });
    expect(buscarSugerencias.mock.calls[0][1]).toEqual([candidata]);
  });

  /**
   * Si la consulta falla —porque nadie cargó los niveles, por ejemplo— la ruta
   * no puede dejar que la excepción suba: Next devolvería un 500 con cuerpo
   * HTML y el navegador reventaría al leerlo como JSON.
   */
  it("si la base falla responde 500 con un JSON que lo explica", async () => {
    buscarSugerencias.mockRejectedValue(new Error('relation "cefr_levels" does not exist'));

    const res = await pide({ candidatas: [candidata], suelo: "B2" });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).error).toMatch(/niveles|migraciones/i);
  });
});
