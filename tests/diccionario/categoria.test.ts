import { describe, it, expect } from "vitest";
import { nombreDeCategoria, agruparPorCategoria } from "@/lib/diccionario/categoria";

/** Lo mínimo que necesita el agrupador: el resto de la acepción le da igual. */
function acepcion(id: number, pos: string) {
  return { id, pos };
}

describe("nombreDeCategoria", () => {
  it("traduce las categorías que trae Wikcionario", () => {
    expect(nombreDeCategoria("noun")).toBe("Sustantivo");
    expect(nombreDeCategoria("verb")).toBe("Verbo");
    expect(nombreDeCategoria("adj")).toBe("Adjetivo");
    expect(nombreDeCategoria("prep_phrase")).toBe("Locución preposicional");
    expect(nombreDeCategoria("proverb")).toBe("Refrán");
  });

  it("devuelve tal cual una categoría que no conoce, en vez de romperse", () => {
    expect(nombreDeCategoria("circumfix")).toBe("circumfix");
  });
});

describe("agruparPorCategoria", () => {
  it("junta las acepciones que comparten categoría", () => {
    const grupos = agruparPorCategoria([
      acepcion(1, "noun"),
      acepcion(2, "verb"),
      acepcion(3, "noun"),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos[0].acepciones.map((a) => a.id)).toEqual([1, 3]);
    expect(grupos[1].acepciones.map((a) => a.id)).toEqual([2]);
  });

  it("usa el orden fijo, no el de llegada: el sustantivo va antes que el verbo", () => {
    const grupos = agruparPorCategoria([acepcion(1, "verb"), acepcion(2, "noun")]);

    expect(grupos.map((g) => g.pos)).toEqual(["noun", "verb"]);
  });

  it("dentro de un grupo respeta el orden en que llegaron", () => {
    const grupos = agruparPorCategoria([
      acepcion(7, "noun"),
      acepcion(3, "noun"),
      acepcion(5, "noun"),
    ]);

    expect(grupos[0].acepciones.map((a) => a.id)).toEqual([7, 3, 5]);
  });

  it("manda al final las categorías que no están en el orden conocido", () => {
    const grupos = agruparPorCategoria([acepcion(1, "circumfix"), acepcion(2, "adj")]);

    expect(grupos.map((g) => g.pos)).toEqual(["adj", "circumfix"]);
  });

  it("cada grupo trae su nombre ya traducido, listo para pintar", () => {
    const [grupo] = agruparPorCategoria([acepcion(1, "prep_phrase")]);

    expect(grupo.nombre).toBe("Locución preposicional");
  });

  it("sin acepciones no hay grupos", () => {
    expect(agruparPorCategoria([])).toEqual([]);
  });
});
