import { describe, it, expect, vi } from "vitest";
import {
  buscarTermino,
  anadirAcepcion,
  acepcionConTraduccion,
  avisoSinAcepciones,
  botonAnadirDeshabilitado,
  cuandoTocaRepasar,
  afinarConIA,
} from "@/components/BuscadorDiccionario";

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

describe("afinarConIA", () => {
  it("manda el id de la acepción y devuelve las traducciones afinadas", async () => {
    const fetchFalso = fetchQueDevuelve({ translations: ["reacio", "poco dispuesto"], costUsd: 0.001 });
    const traducciones = await afinarConIA(1, fetchFalso as unknown as typeof fetch);

    const [url, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/diccionario/afinar");
    expect(JSON.parse(String(opciones.body))).toEqual({ entryId: 1 });
    expect(traducciones).toEqual(["reacio", "poco dispuesto"]);
  });

  it("propaga el error del servidor con su mensaje", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Esa acepción no existe." }, 404);
    await expect(afinarConIA(1, fetchFalso as unknown as typeof fetch)).rejects.toThrow(
      "Esa acepción no existe.",
    );
  });

  it("un fallo de red no se propaga sin mensaje", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      afinarConIA(1, fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/no se pudo afinar/i);
  });
});

describe("acepcionConTraduccion", () => {
  it("lo escrito a mano manda sobre lo que trajo el traductor", () => {
    const conManual = acepcionConTraduccion({ ...acepcion, translations: ["banco"] }, "  orilla  ");
    expect(conManual.translations).toEqual(["orilla"]);
  });

  it("sin nada escrito se guarda lo del traductor", () => {
    expect(acepcionConTraduccion(acepcion, "   ").translations).toEqual(["orilla"]);
  });

  it("da salida a una acepción sin traducción ninguna: es la vía gratuita", () => {
    const sinTraduccion = { ...acepcion, translations: [] };
    expect(acepcionConTraduccion(sinTraduccion, "orilla").translations).toEqual(["orilla"]);
  });
});

describe("cuandoTocaRepasar", () => {
  const ahora = new Date("2026-09-08T10:00:00Z");

  it("lo vencido toca ahora", () => {
    expect(cuandoTocaRepasar("2026-09-01T10:00:00Z", ahora)).toBe("toca ahora");
  });

  it("lo que vence dentro de unos días lo dice en días", () => {
    expect(cuandoTocaRepasar("2026-09-11T10:00:00Z", ahora)).toBe("toca en 3 días");
  });

  it("una fecha ilegible no rompe la pantalla", () => {
    expect(cuandoTocaRepasar("no es una fecha", ahora)).toBe("sin fecha de repaso");
  });
});

describe("avisoSinAcepciones", () => {
  it("con acepciones no avisa de nada", () => {
    expect(avisoSinAcepciones(2, 0)).toBeNull();
  });

  it("sin acepciones y sin nada guardado: no está en el diccionario", () => {
    expect(avisoSinAcepciones(0, 0)).toBe("no-esta");
  });

  it("sin acepciones pero ya guardado: no se dice que no está, porque sí lo tiene", () => {
    expect(avisoSinAcepciones(0, 1)).toBe("solo-en-biblioteca");
  });
});

describe("botonAnadirDeshabilitado", () => {
  it("se deshabilita sin nivel elegido", () => {
    expect(botonAnadirDeshabilitado("", 1, false)).toBe(true);
  });

  it("se deshabilita sin traducción al español", () => {
    expect(botonAnadirDeshabilitado("B1", 0, false)).toBe(true);
  });

  it("se habilita sin traductor si la usuaria escribe la traducción a mano", () => {
    expect(botonAnadirDeshabilitado("B1", 0, false, "orilla")).toBe(false);
  });

  it("los espacios no cuentan como traducción escrita", () => {
    expect(botonAnadirDeshabilitado("B1", 0, false, "   ")).toBe(true);
  });

  it("se deshabilita mientras la petición de esta tarjeta está en vuelo, aunque nivel y traducción ya estén listos", () => {
    expect(botonAnadirDeshabilitado("B1", 1, true)).toBe(true);
  });

  it("se habilita con nivel, traducción y sin ninguna petición en vuelo", () => {
    expect(botonAnadirDeshabilitado("B1", 1, false)).toBe(false);
  });
});

/**
 * Cuando el servidor falla de verdad —una tabla que no existe, por ejemplo—
 * Next devuelve un 500 cuyo cuerpo no es JSON. Antes, `res.json()` reventaba y
 * la pantalla enseñaba el mensaje interno del navegador: en Safari,
 * "The string did not match the expected pattern.", que no le dice nada a nadie.
 */
describe("cuando el servidor responde algo que no es JSON", () => {
  function fetchQueDevuelveHtml(status: number) {
    return vi.fn<typeof fetch>(
      async () =>
        new Response("<!DOCTYPE html><html><body>Internal Server Error</body></html>", {
          status,
          headers: { "Content-Type": "text/html" },
        }),
    );
  }

  it("buscarTermino da un mensaje legible, no el del navegador", async () => {
    await expect(
      buscarTermino("bank", fetchQueDevuelveHtml(500)),
    ).rejects.toThrow(/servidor/i);
  });

  it("el mensaje de buscarTermino nombra el código, para poder decir qué pasó", async () => {
    await expect(
      buscarTermino("bank", fetchQueDevuelveHtml(500)),
    ).rejects.toThrow(/500/);
  });

  it("anadirAcepcion tampoco escupe el mensaje del navegador", async () => {
    await expect(
      anadirAcepcion(acepcion, "B1", fetchQueDevuelveHtml(500)),
    ).rejects.toThrow(/servidor/i);
  });

  it("afinarConIA tampoco", async () => {
    await expect(afinarConIA(1, fetchQueDevuelveHtml(500))).rejects.toThrow(/servidor/i);
  });

  it("una respuesta correcta pero con cuerpo vacío no revienta", async () => {
    const fetchVacio = vi.fn<typeof fetch>(async () => new Response("", { status: 200 }));
    await expect(buscarTermino("bank", fetchVacio)).rejects.toThrow(/servidor/i);
  });
});
