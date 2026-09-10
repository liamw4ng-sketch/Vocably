import { describe, it, expect } from "vitest";
import { cupoDeNuevas, SIN_TOPE_DE_NUEVAS } from "@/lib/ajustes";

describe("cupoDeNuevas", () => {
  /**
   * El 0 significa «sin tope», igual que el 0 del tamaño de sesión significa
   * «las que toquen hoy». Es lo que pidió el usuario después de usarlo: el tope
   * de 20 al día se comía en silencio todo lo que añadía, y como ya puede
   * elegir cuántas palabras entran en cada sesión, no hacía falta un segundo
   * freno que nadie ve.
   */
  it("con el tope a 0 no hay cupo que gastar", () => {
    expect(cupoDeNuevas(SIN_TOPE_DE_NUEVAS, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(cupoDeNuevas(SIN_TOPE_DE_NUEVAS, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it("con tope, descuenta lo ya introducido hoy", () => {
    expect(cupoDeNuevas(20, 0)).toBe(20);
    expect(cupoDeNuevas(20, 7)).toBe(13);
    expect(cupoDeNuevas(20, 20)).toBe(0);
  });

  /** Bajar el tope por debajo de lo ya hecho no puede dar un cupo negativo. */
  it("nunca baja de cero", () => {
    expect(cupoDeNuevas(5, 9)).toBe(0);
  });
});
