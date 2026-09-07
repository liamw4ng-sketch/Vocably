import { describe, it, expect } from "vitest";
import { filasDeLinea, esGlosaInutil } from "@/lib/diccionario/entrada";

const comeAcross = JSON.stringify({
  w: "Come Across",
  p: "verb",
  s: [
    { g: "Used other than figuratively or idiomatically: see come, across.", e: "He came across the street." },
    { g: "To find, usually by accident.", e: "He came across an old box.", es: ["encontrar", "toparse con"] },
    { g: "To give an appearance or impression." },
  ],
});

describe("filasDeLinea", () => {
  it("crea una fila por acepción, con la clave normalizada", () => {
    const filas = filasDeLinea(comeAcross);
    expect(filas).toHaveLength(2);
    expect(filas[0].termNormalized).toBe("come across");
    expect(filas[0].term).toBe("Come Across");
    expect(filas[0].pos).toBe("verb");
  });

  it("descarta la glosa que remite a las palabras sueltas", () => {
    const glosas = filasDeLinea(comeAcross).map((f) => f.gloss);
    expect(glosas).not.toContain(
      "Used other than figuratively or idiomatically: see come, across.",
    );
    expect(glosas[0]).toBe("To find, usually by accident.");
  });

  it("conserva ejemplo y traducciones, y admite que falten", () => {
    const [primera, segunda] = filasDeLinea(comeAcross);
    expect(primera.example).toBe("He came across an old box.");
    expect(primera.translations).toEqual(["encontrar", "toparse con"]);
    expect(segunda.example).toBeNull();
    expect(segunda.translations).toEqual([]);
  });

  it("devuelve vacío si todas las acepciones son basura", () => {
    const soloBasura = JSON.stringify({
      w: "look at",
      p: "verb",
      s: [{ g: "Used other than figuratively or idiomatically: see look, at." }],
    });
    expect(filasDeLinea(soloBasura)).toEqual([]);
  });

  it("devuelve vacío ante una línea ilegible, sin reventar la carga", () => {
    expect(filasDeLinea("{esto no es json")).toEqual([]);
    expect(filasDeLinea("")).toEqual([]);
  });

  it("devuelve vacío ante JSON válido que no es un objeto", () => {
    expect(filasDeLinea("null")).toEqual([]);
    expect(filasDeLinea("123")).toEqual([]);
    expect(filasDeLinea('"texto"')).toEqual([]);
  });
});

describe("esGlosaInutil", () => {
  it("reconoce las remisiones y las formas alternativas", () => {
    expect(esGlosaInutil("Used other than figuratively or idiomatically: see x, y.")).toBe(true);
    expect(esGlosaInutil("Alternative form of colour.")).toBe(true);
    expect(esGlosaInutil("Synonym of bite off more than one can chew.")).toBe(false);
    expect(esGlosaInutil("To find, usually by accident.")).toBe(false);
  });
});
