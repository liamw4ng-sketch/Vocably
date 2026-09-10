import { describe, it, expect, vi } from "vitest";
import {
  buscarTermino,
  anadirAcepcion,
  avisoSinAcepciones,
  botonAnadirDeshabilitado,
  cuandoTocaRepasar,
  afinarConIA,
  entradaParaGuardar,
  botonAfinarDeshabilitado,
  conTraduccionesAfinadas,
  traduccionSeleccionadaTrasAfinar,
  significadosNumerados,
  traduccionMarcada,
} from "@/components/BuscadorDiccionario";

const acepcion = {
  id: 1,
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "They sat on the bank.",
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
    await anadirAcepcion(acepcion, "B1", "orilla", fetchFalso as unknown as typeof fetch);

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
      anadirAcepcion(acepcion, "", "orilla", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/nivel/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("propaga el error del servidor con su mensaje", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Elige un nivel del MCER." }, 400);
    await expect(
      anadirAcepcion(acepcion, "B1", "orilla", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Elige un nivel del MCER.");
  });

  it("manda la traducción que se le pasa, no la de la acepción", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const acepcion = {
      id: 1, term: "bank", pos: "noun", gloss: "An edge of a river.",
      example: null, translations: [], yaGuardada: false,
    };

    await anadirAcepcion(acepcion, "B2", "orilla", fetchFalso as unknown as typeof fetch);

    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(cuerpo.translation).toBe("orilla");
    expect(cuerpo.gloss).toBe("An edge of a river.");
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

describe("entradaParaGuardar", () => {
  /**
   * El significado inglés elegido es lo que se guarda como pista, y es lo único
   * que distingue `bank`→orilla de `bank`→banco en la biblioteca.
   */
  it("guarda el significado elegido como pista, no otro", () => {
    const e = entradaParaGuardar(acepcion, "orilla", "B2");
    expect(e.term).toBe("bank");
    expect(e.gloss).toBe("An edge of a river.");
    expect(e.pos).toBe("noun");
    expect(e.example).toBe("They sat on the bank.");
  });

  it("guarda la traducción elegida, venga de donde venga", () => {
    expect(entradaParaGuardar(acepcion, "ribera", "B2").translation).toBe("ribera");
  });

  it("recorta la traducción escrita a mano", () => {
    expect(entradaParaGuardar(acepcion, "  ribera  ", "B2").translation).toBe("ribera");
  });

  it("guarda el nivel elegido", () => {
    expect(entradaParaGuardar(acepcion, "orilla", "C1").level).toBe("C1");
  });
});

describe("botonAnadirDeshabilitado", () => {
  /** Las tres elecciones son obligatorias: sin una de ellas no hay tarjeta que guardar. */
  it("hacen falta significado, traducción y nivel", () => {
    expect(botonAnadirDeshabilitado(null, "orilla", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "   ", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "B2", false)).toBe(false);
  });

  /**
   * Con la petición en vuelo se deshabilita: dos toques mandarían dos POST antes
   * de que la pantalla se entere del primero.
   */
  it("con la petición en vuelo, deshabilitado", () => {
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "B2", true)).toBe(true);
  });
});

describe("conTraduccionesAfinadas", () => {
  /**
   * Lo que devuelve el botón de pago va delante: es la traducción curada de la
   * acepción concreta que el usuario eligió, así que es la mejor de la lista.
   */
  it("mete lo afinado al principio", () => {
    expect(conTraduccionesAfinadas(["banco", "Banco."], ["orilla"])).toEqual([
      "orilla",
      "banco",
      "Banco.",
    ]);
  });

  it("no duplica lo que ya estaba", () => {
    expect(conTraduccionesAfinadas(["banco"], ["Banco", "orilla"])).toEqual(["orilla", "banco"]);
  });

  it("sin nada afinado deja la lista como estaba", () => {
    expect(conTraduccionesAfinadas(["banco"], [])).toEqual(["banco"]);
  });

  /**
   * `traduccionesPosibles` deduplica también dentro de un mismo grupo: si
   * `lista` trae dos formas equivalentes, el primer grupo no sobrevive con
   * `lista.length` elementos. Cortar por esa longitud a ciegas se comería
   * traducciones afinadas de verdad — aquí, "orilla" es lo único que costó
   * dinero, y no puede perderse.
   */
  it("no se come lo afinado cuando la lista trae dos formas equivalentes", () => {
    expect(conTraduccionesAfinadas(["banco", "Banco"], ["orilla"])).toEqual([
      "orilla",
      "banco",
      "Banco",
    ]);
  });
});

describe("traduccionSeleccionadaTrasAfinar", () => {
  /**
   * El caso que dejaba la pantalla sin ningún radio marcado: si lo que
   * devuelve la IA ya estaba en la lista salvo por mayúsculas o espacios,
   * `conTraduccionesAfinadas` conserva la forma vieja, no la de la IA.
   * Seleccionar la forma de la IA no casaría con ningún `t` de la lista
   * pintada; hay que seleccionar la que de verdad sobrevive.
   */
  it("si lo afinado ya estaba, selecciona la forma que sobrevive, no la que devolvió la IA", () => {
    expect(traduccionSeleccionadaTrasAfinar(["banco"], ["Banco", "orilla"])).toBe("orilla");
  });

  it("si lo afinado es genuinamente nuevo, lo selecciona a él", () => {
    expect(traduccionSeleccionadaTrasAfinar(["banco"], ["ribera"])).toBe("ribera");
  });

  it("sin nada afinado, selecciona lo primero que ya había", () => {
    expect(traduccionSeleccionadaTrasAfinar(["banco"], [])).toBe("banco");
  });
});

describe("botonAfinarDeshabilitado", () => {
  /**
   * Afinar pide a Claude la traducción de UNA acepción concreta: sin significado
   * elegido no hay nada que afinar, y es el único botón que cuesta dinero.
   */
  it("hace falta un significado elegido", () => {
    expect(botonAfinarDeshabilitado(null, false)).toBe(true);
    expect(botonAfinarDeshabilitado(acepcion, false)).toBe(false);
  });

  it("con la petición en vuelo, deshabilitado", () => {
    expect(botonAfinarDeshabilitado(acepcion, true)).toBe(true);
  });
});

describe("significadosNumerados", () => {
  /**
   * §7: esconder un significado ya guardado cambiaría la numeración entre
   * visitas. La numeración se apoya en la posición dentro de la lista
   * completa —guardados incluidos—, no en un contador aparte.
   */
  it("numera desde 1 y no salta aunque haya guardados en medio", () => {
    const acepciones = [
      { ...acepcion, id: 1, gloss: "A financial institution.", yaGuardada: false },
      { ...acepcion, id: 2, gloss: "An edge of a river.", yaGuardada: true },
      { ...acepcion, id: 3, gloss: "A row of objects.", yaGuardada: false },
    ];

    expect(significadosNumerados(acepciones).map((s) => s.numero)).toEqual([1, 2, 3]);
  });

  it("un significado ya guardado conserva su número en su sitio y sale como no elegible", () => {
    const acepciones = [
      { ...acepcion, id: 1, gloss: "A financial institution.", yaGuardada: false },
      { ...acepcion, id: 2, gloss: "An edge of a river.", yaGuardada: true },
    ];

    const numerados = significadosNumerados(acepciones);
    expect(numerados[1].numero).toBe(2);
    expect(numerados[1].elegible).toBe(false);
    expect(numerados[0].elegible).toBe(true);
  });
});

describe("traduccionMarcada", () => {
  /**
   * La misma regla que antes vivía por duplicado en el JSX (qué radio se
   * pinta marcado) y en el cálculo de qué se guarda. Que sea una sola
   * función evita que puedan separarse sin querer, que es exactamente el
   * fallo que arregló 477e90c: una traducción guardada sin ningún radio
   * marcado.
   */
  it("una opción está marcada si coincide con la elegida y no hay nada escrito a mano", () => {
    expect(traduccionMarcada("orilla", "orilla", "")).toBe(true);
  });

  it("otra opción no está marcada aunque haya una elegida", () => {
    expect(traduccionMarcada("banco", "orilla", "")).toBe(false);
  });

  it("escribir algo a mano desmarca cualquier opción de la lista, aunque coincida", () => {
    expect(traduccionMarcada("orilla", "orilla", "ribera")).toBe(false);
  });

  it("un manual que solo tiene espacios no cuenta como escrito: la opción elegida sigue marcada", () => {
    expect(traduccionMarcada("orilla", "orilla", "   ")).toBe(true);
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
      anadirAcepcion(acepcion, "B1", "orilla", fetchQueDevuelveHtml(500)),
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
