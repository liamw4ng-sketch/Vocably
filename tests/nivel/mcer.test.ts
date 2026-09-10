import { describe, it, expect } from "vitest";
import {
  alcanzaElSuelo,
  categoriaDelProyecto,
  esNivel,
  filasDeLineaMcer,
} from "@/lib/nivel/mcer";

describe("esNivel", () => {
  it("acepta los seis del MCER y nada más", () => {
    expect(esNivel("B2")).toBe(true);
    expect(esNivel("A1")).toBe(true);
    expect(esNivel("D1")).toBe(false);
    expect(esNivel("b2")).toBe(false);
    expect(esNivel(2)).toBe(false);
    expect(esNivel(undefined)).toBe(false);
  });
});

describe("alcanzaElSuelo", () => {
  it("deja pasar lo que está en el suelo o por encima", () => {
    expect(alcanzaElSuelo("B2", "B2")).toBe(true);
    expect(alcanzaElSuelo("C1", "B2")).toBe(true);
    expect(alcanzaElSuelo("C2", "A1")).toBe(true);
  });

  it("corta lo que está por debajo", () => {
    expect(alcanzaElSuelo("B1", "B2")).toBe(false);
    expect(alcanzaElSuelo("A1", "A2")).toBe(false);
  });
});

describe("categoriaDelProyecto", () => {
  /**
   * El listado y el diccionario nombran distinto lo mismo. Sin traducir, ninguna
   * palabra casaría con su ficha y el filtro se quedaría sin nada que filtrar.
   */
  it("traduce las cuatro categorías que son el 97 % del listado", () => {
    expect(categoriaDelProyecto("noun")).toBe("noun");
    expect(categoriaDelProyecto("adjective")).toBe("adj");
    expect(categoriaDelProyecto("verb")).toBe("verb");
    expect(categoriaDelProyecto("adverb")).toBe("adv");
  });

  it("traduce también la cola", () => {
    expect(categoriaDelProyecto("pronoun")).toBe("pron");
    expect(categoriaDelProyecto("preposition")).toBe("prep");
    expect(categoriaDelProyecto("determiner")).toBe("det");
    expect(categoriaDelProyecto("conjunction")).toBe("conj");
    expect(categoriaDelProyecto("number")).toBe("num");
    expect(categoriaDelProyecto("interjection")).toBe("intj");
  });

  /** Las cinco variantes verbales del listado son verbos a efectos del diccionario. */
  it("mete las variantes verbales en `verb`", () => {
    for (const p of ["modal auxiliary", "be-verb", "do-verb", "have-verb", "infinitive-to"]) {
      expect(categoriaDelProyecto(p)).toBe("verb");
    }
  });

  /**
   * El volcado trae dos filas malas: una con la categoría vacía y otra que dice
   * `vern`, errata evidente de `verb`. Se tratan a propósito, no por accidente.
   */
  it("trata `vern` como verbo y descarta la categoría vacía", () => {
    expect(categoriaDelProyecto("vern")).toBe("verb");
    expect(categoriaDelProyecto("")).toBeNull();
    expect(categoriaDelProyecto("   ")).toBeNull();
  });

  it("descarta una categoría que no conoce, en vez de inventarse una", () => {
    expect(categoriaDelProyecto("gerundio")).toBeNull();
  });
});

describe("filasDeLineaMcer", () => {
  it("saca palabra, categoría traducida y nivel", () => {
    expect(filasDeLineaMcer("abandon,verb,B1,,,")).toEqual([
      { termNormalized: "abandon", term: "abandon", pos: "verb", level: "B1" },
    ]);
  });

  /**
   * Las columnas cuarta y siguientes traen comas dentro de comillas. Como ningún
   * headword lleva coma, quedarse con los tres primeros trozos es seguro.
   */
  it("no se despista con las comas de las columnas de más allá", () => {
    const linea = 'accident,noun,A2,"News, lifestyles and current affairs",,Health';
    expect(filasDeLineaMcer(linea)).toEqual([
      { termNormalized: "accident", term: "accident", pos: "noun", level: "A2" },
    ]);
  });

  /**
   * 213 entradas traen varias grafías. Sin desdoblarlas, `airplane` se quedaría
   * sin nivel y no saldría nunca como candidata.
   */
  it("desdobla las variantes separadas por barra", () => {
    expect(filasDeLineaMcer("airplane/aeroplane,noun,A2,,,")).toEqual([
      { termNormalized: "airplane", term: "airplane", pos: "noun", level: "A2" },
      { termNormalized: "aeroplane", term: "aeroplane", pos: "noun", level: "A2" },
    ]);
  });

  it("no repite variantes que normalizan igual", () => {
    const filas = filasDeLineaMcer("a.m./A.M./am/AM,adverb,A1,,,");
    expect(filas.map((f) => f.termNormalized)).toEqual(["a.m.", "am"]);
  });

  it("salta la cabecera y las líneas que no sirven", () => {
    expect(filasDeLineaMcer("headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold")).toEqual([]);
    expect(filasDeLineaMcer("")).toEqual([]);
    expect(filasDeLineaMcer("abandon,verb")).toEqual([]);
    expect(filasDeLineaMcer("abandon,gerundio,B1")).toEqual([]);
    expect(filasDeLineaMcer("abandon,verb,D1")).toEqual([]);
    expect(filasDeLineaMcer(",verb,B1")).toEqual([]);
  });
});
