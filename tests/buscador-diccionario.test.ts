import { describe, it, expect, vi } from "vitest";
import { buscarTermino, anadirAcepcion } from "@/components/BuscadorDiccionario";

const acepcion = {
  id: 1,
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "We sat on the bank.",
  translations: ["orilla"],
  yaGuardada: false,
};

const resultado = { termino: "bank", enBiblioteca: [], acepciones: [acepcion] };

function fetchQueDevuelve(cuerpo: unknown, status = 200) {
  // Tipado explícito de `vi.fn`: sin esto, TypeScript infiere una función sin
  // parámetros y `mock.calls[0]` queda como `[]`, una tupla vacía que no se
  // puede indexar ni convertir a `[string, RequestInit]` más abajo.
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(cuerpo), { status }));
}

describe("buscarTermino", () => {
  it("pide la búsqueda con el término escapado", async () => {
    const fetchFalso = fetchQueDevuelve(resultado);
    await buscarTermino("bite off more than you can chew", fetchFalso as unknown as typeof fetch);

    expect(String(fetchFalso.mock.calls[0][0])).toBe(
      "/api/diccionario?q=bite%20off%20more%20than%20you%20can%20chew",
    );
  });

  it("devuelve las acepciones", async () => {
    const devuelto = await buscarTermino("bank", fetchQueDevuelve(resultado) as unknown as typeof fetch);
    expect(devuelto.acepciones[0].gloss).toBe("An edge of a river.");
  });

  it("convierte el error del servidor en un mensaje legible", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Escribe una palabra para buscar." }, 400);
    await expect(
      buscarTermino("  ", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Escribe una palabra para buscar.");
  });

  it("un fallo de red no se propaga sin mensaje: el campo no puede quedarse colgado", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      buscarTermino("bank", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/no se pudo buscar/i);
  });
});

describe("anadirAcepcion", () => {
  it("manda el término, su significado como pista y el nivel elegido", async () => {
    const fetchFalso = fetchQueDevuelve({ termId: 3, created: true }, 201);
    await anadirAcepcion(acepcion, "B1", fetchFalso as unknown as typeof fetch);

    const [url, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/terms");
    expect(JSON.parse(String(opciones.body))).toMatchObject({
      term: "bank",
      pos: "noun",
      gloss: "An edge of a river.",
      translation: "orilla",
      level: "B1",
    });
  });

  it("sin nivel no llama al servidor", async () => {
    const fetchFalso = fetchQueDevuelve({}, 201);
    await expect(
      anadirAcepcion(acepcion, "", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/nivel/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("propaga el error del servidor con su mensaje", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Elige un nivel del MCER." }, 400);
    await expect(
      anadirAcepcion(acepcion, "B1", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Elige un nivel del MCER.");
  });
});
