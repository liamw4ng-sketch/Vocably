import { describe, it, expect } from "vitest";
import { filaDeLineaEspanola, MAXIMO_SIGNIFICADOS_GUARDADOS } from "@/lib/diccionario/espanol";

const language = JSON.stringify({
  w: "language",
  p: "noun",
  s: ["Idioma.", "Lengua, lenguaje.", "Léxico, jerga, vocabulario."],
});

describe("filaDeLineaEspanola", () => {
  it("saca la palabra, su categoría y sus significados en orden", () => {
    expect(filaDeLineaEspanola(language)).toEqual({
      termNormalized: "language",
      term: "language",
      pos: "noun",
      meanings: ["Idioma.", "Lengua, lenguaje.", "Léxico, jerga, vocabulario."],
    });
  });

  /**
   * La clave de comparación se normaliza igual que en el resto del proyecto,
   * porque es con lo que se busca: sin esto, "Come Across" no encontraría nada.
   */
  it("normaliza la clave pero conserva la palabra tal como se escribe", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "  Come   Across ", p: "verb", s: ["Encontrarse."] }));
    expect(fila?.termNormalized).toBe("come across");
    expect(fila?.term).toBe("Come   Across");
  });

  it("recorta a ocho significados", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => `Significado ${i + 1}.`);
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "set", p: "verb", s: nueve }));
    expect(fila?.meanings).toHaveLength(MAXIMO_SIGNIFICADOS_GUARDADOS);
    expect(fila?.meanings.at(-1)).toBe("Significado 8.");
  });

  /**
   * Una línea mala no puede tumbar una carga de 21.000: se salta y ya. Es la
   * misma decisión que en `filasDeLinea` del volcado inglés.
   */
  it("devuelve null en vez de reventar con una línea que no sirve", () => {
    expect(filaDeLineaEspanola("{ esto no es json")).toBeNull();
    expect(filaDeLineaEspanola("null")).toBeNull();
    expect(filaDeLineaEspanola("")).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun" }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: [] }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "", p: "noun", s: ["Perro."] }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "", s: ["Perro."] }))).toBeNull();
  });

  it("descarta los significados vacíos y no cuenta la entrada si no queda ninguno", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["", "  ", "Perro."] }));
    expect(fila?.meanings).toEqual(["Perro."]);
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["", "  "] }))).toBeNull();
  });

  it("ignora los significados que no son cadenas", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["Perro.", 42, null] }));
    expect(fila?.meanings).toEqual(["Perro."]);
  });
});
