import { describe, it, expect } from "vitest";
import { marcadorDeSesion, mostrarContexto } from "@/components/SesionRepaso";
import type { Resumen } from "@/lib/review-session";

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

/** El contador de una sesión a medias. */
function conteo(parcial: Partial<Resumen> = {}): Resumen {
  return { total: 0, otraVez: 0, dificil: 0, bien: 0, facil: 0, noGuardadas: 0, ...parcial };
}

describe("marcadorDeSesion", () => {
  /**
   * Lo pidió mientras repasaba: «una especie de estadística arriba que diga
   * cosas como el número de palabras que me han parecido difíciles... no solo
   * al final del test».
   */
  it("cuenta cada botón que ya has pulsado, en el orden de los botones", () => {
    const marcador = marcadorDeSesion(conteo({ total: 6, dificil: 2, bien: 3, facil: 1 }));
    expect(marcador.map((m) => [m.etiqueta, m.valor])).toEqual([
      ["Difícil", 2],
      ["Bien", 3],
      ["Fácil", 1],
    ]);
  });

  /** Un cero no informa de nada y roba sitio en la pantalla del móvil. */
  it("deja fuera lo que todavía no has pulsado", () => {
    expect(marcadorDeSesion(conteo({ total: 1, facil: 1 }))).toHaveLength(1);
  });

  it("antes de responder nada no enseña marcador", () => {
    expect(marcadorDeSesion(conteo())).toEqual([]);
  });

  /** El color es el mismo del botón que se pulsó: si no, no se reconocen. */
  it("cada uno trae el color de su botón", () => {
    const [otraVez] = marcadorDeSesion(conteo({ total: 1, otraVez: 1 }));
    expect(otraVez.clase).toBe("bg-valoracion-otra-vez");
  });
});
