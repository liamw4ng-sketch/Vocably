import { describe, it, expect } from "vitest";
import { mostrarContexto } from "@/components/SesionRepaso";

describe("mostrarContexto", () => {
  it("no repite la glosa: lo añadido desde el diccionario la guarda como pista y como contexto", () => {
    expect(mostrarContexto("An edge of a river.", "An edge of a river.")).toBe(false);
  });

  it("tampoco la repite si solo difieren en espacios sobrantes", () => {
    expect(mostrarContexto("  An edge of a river. ", "An edge of a river.")).toBe(false);
  });

  it("una frase de verdad, la de un PDF, sí se enseña", () => {
    expect(mostrarContexto("We sat on the bank of the river.", "An edge of a river.")).toBe(true);
  });

  it("lo extraído de un PDF no tiene pista y su contexto se sigue enseñando", () => {
    expect(mostrarContexto("I came across an old photo.", "")).toBe(true);
  });

  it("un contexto vacío no pinta nada", () => {
    expect(mostrarContexto("   ", "")).toBe(false);
  });
});
