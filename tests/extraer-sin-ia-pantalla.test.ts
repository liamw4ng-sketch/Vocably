import { describe, it, expect, vi } from "vitest";
import {
  avisoSinSugerencias,
  etiquetaDeNivel,
  guardarMarcadas,
  nivelParaGuardar,
  pedirSugerencias,
  sinTraduccionAlEspanol,
} from "@/components/ExtraerSinIA";

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
 * Hallazgo de revisión: una sugerencia sin significados en español se
 * guardaba con `translation: ""` — una tarjeta de repaso con el reverso en
 * blanco, que no se puede estudiar. `BuscadorDiccionario.tsx` ya resuelve
 * este caso con `sinEspanolEnNingunOrigen`; aquí es lo mismo, pero sobre las
 * sugerencias de esta pantalla en vez de sobre una búsqueda.
 */
describe("sinTraduccionAlEspanol", () => {
  it("una sugerencia sin significados no se puede marcar", () => {
    expect(sinTraduccionAlEspanol([])).toBe(true);
  });

  it("una sugerencia con significados sí se puede marcar", () => {
    expect(sinTraduccionAlEspanol(["perro"])).toBe(false);
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

describe("guardarMarcadas", () => {
  it("manda todo en una sola petición", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ creadas: 2, repetidas: 0, fallidas: 0 })),
    );
    const entradas = [
      { term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" },
      { term: "cat", pos: "noun", gloss: "Another.", example: null, translation: "gato", level: "B1" },
    ];

    const r = await guardarMarcadas(entradas, fetchFalso as unknown as typeof fetch);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchFalso.mock.calls[0][1]?.body)).entradas).toHaveLength(2);
    expect(r).toEqual({ creadas: 2, repetidas: 0, fallidas: 0 });
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
      [{ term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" }],
      fetchFalso as unknown as typeof fetch,
    );

    expect(r).toEqual({ creadas: 38, repetidas: 0, fallidas: 2 });
  });

  it("un fallo de red da un mensaje en español", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      guardarMarcadas(
        [{ term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" }],
        fetchFalso as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/conexión/i);
  });

  it("un error del servidor se propaga con su mensaje", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Ninguna de las palabras enviadas está completa." }), {
        status: 400,
      }),
    );
    await expect(
      guardarMarcadas(
        [{ term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" }],
        fetchFalso as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Ninguna de las palabras enviadas está completa.");
  });
});
