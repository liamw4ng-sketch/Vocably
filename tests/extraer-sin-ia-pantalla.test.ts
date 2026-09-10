import { describe, it, expect, vi } from "vitest";
import {
  avisoSinSugerencias,
  entradasParaGuardar,
  etiquetaDeNivel,
  guardarMarcadas,
  nivelParaGuardar,
  pedirSugerencias,
  sinTraduccionAlEspanol,
  textoDelAviso,
  traduccionDeLaSugerencia,
  type Sugerencia,
} from "@/components/ExtraerSinIA";

/** Una sugerencia con lo justo; cada prueba cambia lo que le interesa. */
const sugerencia = (cambios: Partial<Sugerencia> = {}): Sugerencia => ({
  term: "language",
  pos: "noun",
  gloss: "A system of communication.",
  example: null,
  frase: "He spoke a strange language.",
  traducciones: [],
  significados: [],
  nivel: "B1",
  tipo: "word",
  ...cambios,
});

/**
 * Los cinco significados del Wikcionario español de `language`. Son
 * definiciones enteras, con su punto final y sus comas internas: es la razón
 * de que unirlas con `join(", ")` no valga como reverso de una tarjeta.
 */
const DEL_WIKCIONARIO = [
  "Idioma.",
  "Lengua, lenguaje.",
  "Léxico, jerga, vocabulario.",
  "Redacción, texto.",
  "Grosería, lenguaje soez.",
];

describe("etiquetaDeNivel", () => {
  it("dice el nivel cuando está medido", () => {
    expect(etiquetaDeNivel("B2")).toBe("B2");
  });

  /**
   * Un verbo frasal no tiene nivel en ninguna fuente gratuita. Enseñar el suelo
   * como si fuera suyo sería fingir una precisión que no hay.
   */
  it("cuando no está medido lo dice, no finge", () => {
    expect(etiquetaDeNivel(null)).toBe("sin nivel");
  });
});

describe("nivelParaGuardar", () => {
  it("guarda el nivel medido cuando lo hay", () => {
    expect(nivelParaGuardar("C1", "B1")).toBe("C1");
  });

  it("y el suelo elegido cuando no lo hay", () => {
    expect(nivelParaGuardar(null, "B1")).toBe("B1");
  });
});

describe("avisoSinSugerencias", () => {
  it("no avisa de nada si hay sugerencias", () => {
    expect(avisoSinSugerencias(true, 5)).toBeNull();
  });

  /** Un PDF escaneado es una imagen: no hay texto que analizar. */
  it("sin texto extraído, avisa de que puede ser un escaneo", () => {
    expect(avisoSinSugerencias(false, 0)).toBe("sin-texto");
  });

  /**
   * Con texto pero sin sugerencias la causa puede ser el suelo elegido o que ya
   * esté todo guardado; la pantalla no puede saber cuál de las dos es, así que
   * el aviso no puede fingir que lo sabe.
   */
  it("con texto pero sin sugerencias nuevas, avisa sin inventar la causa", () => {
    expect(avisoSinSugerencias(true, 0)).toBe("nada-nuevo");
  });
});

/**
 * Hallazgo de revisión (crítico 1): el reverso se guardaba con
 * `significados.join(", ")`, la regla que este proyecto ya desechó en
 * `BuscadorDiccionario.tsx` porque dejaba reversos de cinco definiciones
 * enteras encadenadas. La escalera buena es la de la pantalla hermana: lo
 * escrito a mano, el español de la acepción, y si no, el primero del español
 * de la palabra.
 */
describe("traduccionDeLaSugerencia", () => {
  it("del español de la palabra se queda con el primero, no los une con comas", () => {
    const s = sugerencia({ significados: DEL_WIKCIONARIO });

    expect(traduccionDeLaSugerencia(s, "")).toBe("Idioma.");
  });

  it("el español de la acepción gana al de la palabra", () => {
    const s = sugerencia({ traducciones: ["idioma", "lenguaje"], significados: DEL_WIKCIONARIO });

    expect(traduccionDeLaSugerencia(s, "")).toBe("idioma, lenguaje");
  });

  it("lo escrito a mano gana a todo lo demás", () => {
    const s = sugerencia({ traducciones: ["idioma"], significados: DEL_WIKCIONARIO });

    expect(traduccionDeLaSugerencia(s, "  lengua  ")).toBe("lengua");
  });

  it("sin nada de español no se inventa un reverso", () => {
    expect(traduccionDeLaSugerencia(sugerencia(), "")).toBe("");
  });
});

/**
 * Hallazgo de revisión (crítico 2): bloquear la casilla sin español dejaba
 * inhabilitado el bloque de los verbos frasales, que es la razón de ser de la
 * rama —el volcado español no los cubre— y lo que la especificación pone
 * primero de todo. En la pantalla hermana el mismo aviso convive con un campo
 * para escribir la traducción a mano, y por eso allí bloquear no deja sin
 * salida. Aquí ahora también.
 */
describe("sinTraduccionAlEspanol", () => {
  it("una sugerencia sin español de ningún origen no se puede marcar", () => {
    expect(sinTraduccionAlEspanol(sugerencia(), "")).toBe(true);
  });

  it("escribir la traducción a mano desbloquea la casilla", () => {
    expect(sinTraduccionAlEspanol(sugerencia(), "rendirse")).toBe(false);
  });

  it("una traducción a mano en blanco no cuenta como escrita", () => {
    expect(sinTraduccionAlEspanol(sugerencia(), "   ")).toBe(true);
  });

  it("con el español de la acepción se puede marcar sin escribir nada", () => {
    expect(sinTraduccionAlEspanol(sugerencia({ traducciones: ["idioma"] }), "")).toBe(false);
  });

  it("con el español de la palabra también", () => {
    expect(sinTraduccionAlEspanol(sugerencia({ significados: DEL_WIKCIONARIO }), "")).toBe(false);
  });

  /**
   * El diferido de la revisión: mirar solo la longitud de la lista daba por
   * buena una lista con una cadena vacía dentro, que es un reverso en blanco
   * igual.
   */
  it("una lista con la cadena vacía dentro no es español que guardar", () => {
    expect(sinTraduccionAlEspanol(sugerencia({ traducciones: [""] }), "")).toBe(true);
  });
});

/**
 * Lo que se manda a `POST /api/terms` de cada candidata marcada. Es donde se
 * juntan los tres hallazgos: el reverso de la escalera, la traducción escrita a
 * mano y la frase del libro, que se enseñaba en pantalla y se tiraba al
 * guardar.
 */
describe("entradasParaGuardar", () => {
  it("guarda el reverso de la escalera, no los significados encadenados", () => {
    const s = [sugerencia({ significados: DEL_WIKCIONARIO })];

    const [entrada] = entradasParaGuardar(s, [0], {}, "B1");

    expect(entrada.translation).toBe("Idioma.");
  });

  it("guarda la traducción escrita a mano cuando la hay", () => {
    const s = [sugerencia({ term: "give up", tipo: "phrasal_verb", nivel: null })];

    const [entrada] = entradasParaGuardar(s, [0], { 0: "rendirse" }, "B1");

    expect(entrada.translation).toBe("rendirse");
  });

  /** La frase es el contexto de la tarjeta: es lo que pidió el usuario. */
  it("manda la frase del libro de cada candidata", () => {
    const s = [
      sugerencia({ frase: "He spoke a strange language.", traducciones: ["idioma"] }),
    ];

    const [entrada] = entradasParaGuardar(s, [0], {}, "B1");

    expect(entrada.context).toBe("He spoke a strange language.");
  });

  it("guarda el nivel medido, y el suelo elegido cuando no lo hay", () => {
    const s = [
      sugerencia({ nivel: "C1", traducciones: ["idioma"] }),
      sugerencia({ term: "give up", nivel: null, traducciones: ["rendirse"] }),
    ];

    const entradas = entradasParaGuardar(s, [0, 1], {}, "B1");

    expect(entradas.map((e) => e.level)).toEqual(["C1", "B1"]);
  });

  /**
   * Si el usuario marca una línea que solo tenía traducción a mano y luego la
   * borra, la casilla se queda marcada un instante. Guardarla dejaría el
   * reverso en blanco, que es justo lo que nada de esto puede permitir.
   */
  it("no manda lo que se quedó sin traducción, aunque estuviera marcado", () => {
    const s = [sugerencia({ term: "give up", nivel: null }), sugerencia({ term: "house" })];

    const entradas = entradasParaGuardar(s, [0, 1], { 1: "casa" }, "B1");

    expect(entradas.map((e) => e.term)).toEqual(["house"]);
  });

  it("solo manda lo marcado", () => {
    const s = ["one", "two", "three"].map((term) =>
      sugerencia({ term, traducciones: [`${term} en español`] }),
    );

    const entradas = entradasParaGuardar(s, [2, 0], {}, "B1");

    expect(entradas.map((e) => e.term)).toEqual(["three", "one"]);
  });
});

/**
 * Hallazgo de revisión (menor 7): el texto de pantalla decía que la causa más
 * probable era un escaneo. El comentario de `lib/extraer/pdf-texto.ts` prohíbe
 * esa redacción: desde ahí no se distingue un escaneo de unas páginas en
 * blanco, y hay que nombrar las dos.
 */
describe("textoDelAviso", () => {
  it("sin texto nombra las dos causas: escaneo y páginas en blanco", () => {
    const texto = textoDelAviso("sin-texto");

    expect(texto).toMatch(/escaneo/i);
    expect(texto).toMatch(/en blanco/i);
  });

  it("y no dice cuál de las dos es más probable", () => {
    expect(textoDelAviso("sin-texto")).not.toMatch(/más probable/i);
  });

  it("con texto pero sin nada nuevo, no inventa la causa", () => {
    expect(textoDelAviso("nada-nuevo")).toMatch(/nivel mínimo/i);
  });
});

describe("pedirSugerencias", () => {
  it("manda las candidatas y el suelo, y devuelve lo que llega", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ sugerencias: [{ term: "abandon" }] })),
    );

    const s = await pedirSugerencias(
      [{ texto: "abandon", frase: "He abandoned it." }],
      "B2",
      fetchFalso as unknown as typeof fetch,
    );

    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(cuerpo.suelo).toBe("B2");
    expect(cuerpo.candidatas).toHaveLength(1);
    expect(s).toEqual([{ term: "abandon" }]);
  });

  it("un fallo de red da un mensaje en español, no deja la pantalla colgada", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      pedirSugerencias([{ texto: "a", frase: "b" }], "B2", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/conexión/i);
  });

  it("un error del servidor se propaga con su mensaje", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Faltan los niveles." }), { status: 500 }),
    );
    await expect(
      pedirSugerencias([{ texto: "a", frase: "b" }], "B2", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Faltan los niveles.");
  });
});

const FUENTE = { title: "Drácula", pageStart: 10, pageEnd: 14, level: "B1" };

const entradaDePrueba = {
  term: "dog",
  pos: "noun",
  gloss: "An animal.",
  example: null,
  translation: "perro",
  level: "B1",
  context: "The dog barked all night.",
};

describe("guardarMarcadas", () => {
  it("manda todo en una sola petición", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ creadas: 2, repetidas: 0, fallidas: 0 })),
    );
    const entradas = [
      entradaDePrueba,
      { ...entradaDePrueba, term: "cat", gloss: "Another.", translation: "gato" },
    ];

    const r = await guardarMarcadas(entradas, FUENTE, fetchFalso as unknown as typeof fetch);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchFalso.mock.calls[0][1]?.body)).entradas).toHaveLength(2);
    expect(r).toEqual({ creadas: 2, repetidas: 0, fallidas: 0 });
  });

  /**
   * Hallazgo de revisión 4: sin esto, las cuarenta palabras de una extracción
   * colgaban de la fuente "Diccionario", que existe para distinguir justamente
   * lo buscado a mano de lo salido de un PDF.
   */
  it("manda el título y el rango de páginas que eligió el usuario", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ creadas: 1, repetidas: 0, fallidas: 0 })),
    );

    await guardarMarcadas([entradaDePrueba], FUENTE, fetchFalso as unknown as typeof fetch);

    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(cuerpo.fuente).toEqual(FUENTE);
    expect(cuerpo.entradas[0].context).toBe("The dog barked all night.");
  });

  /**
   * Se añadió `fallidas` porque una entrada que falle al guardarse ya no aborta
   * el lote: las demás siguen. La pantalla tiene que poder distinguir ese caso
   * del "todo bien" para decírselo al usuario.
   */
  it("devuelve también cuántas fallaron", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ creadas: 38, repetidas: 0, fallidas: 2 })),
    );

    const r = await guardarMarcadas(
      [entradaDePrueba],
      FUENTE,
      fetchFalso as unknown as typeof fetch,
    );

    expect(r).toEqual({ creadas: 38, repetidas: 0, fallidas: 2 });
  });

  it("un fallo de red da un mensaje en español", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      guardarMarcadas([entradaDePrueba], FUENTE, fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/conexión/i);
  });

  it("un error del servidor se propaga con su mensaje", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Ninguna de las palabras enviadas está completa." }), {
        status: 400,
      }),
    );
    await expect(
      guardarMarcadas([entradaDePrueba], FUENTE, fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Ninguna de las palabras enviadas está completa.");
  });
});
