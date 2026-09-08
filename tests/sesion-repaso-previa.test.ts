import { describe, it, expect } from "vitest";
import {
  disponibles,
  puedeEmpezar,
  validarCuantas,
  ETIQUETA_MODO,
} from "@/components/SesionRepaso";
import { MODOS, MAXIMO_TAMANO_SESION } from "@/lib/ajustes";
import type { ResumenColecciones } from "@/db/repository/review";

/** El único mensaje de error que da `validarCuantas`, sea cual sea el motivo. */
const MENSAJE_RANGO = `Debe ser un número entero entre 0 y ${MAXIMO_TAMANO_SESION}.`;

function resumen(
  hoy: { sinAprender: number; aprendidas: number },
  total = hoy,
): ResumenColecciones {
  return { hoy, total };
}

describe("disponibles", () => {
  it("no-aprendidas solo mira la columna de sin aprender", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "no-aprendidas", 0)).toBe(3);
  });

  it("aprendidas solo mira la suya", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "aprendidas", 0)).toBe(9);
  });

  it("mezcla suma las dos", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "mezcla", 0)).toBe(12);
  });

  it("con un número explícito cuenta lo adelantable, no solo lo de hoy", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 4, aprendidas: 6 });
    expect(disponibles(r, "aprendidas", 10)).toBe(6);
    expect(disponibles(r, "aprendidas", 0)).toBe(0);
  });
});

describe("puedeEmpezar", () => {
  it("no deja empezar un modo sin nada que enseñar", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 5 });
    expect(puedeEmpezar(r, "no-aprendidas", 0)).toBe(false);
    expect(puedeEmpezar(r, "aprendidas", 0)).toBe(true);
  });

  it("con un número, un modo vacío hoy sí se puede empezar si hay que adelantar", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 7 });
    expect(puedeEmpezar(r, "aprendidas", 5)).toBe(true);
  });

  it("con la biblioteca vacía no se puede empezar de ninguna manera", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 });
    for (const modo of MODOS) {
      expect(puedeEmpezar(r, modo, 0)).toBe(false);
      expect(puedeEmpezar(r, modo, 20)).toBe(false);
    }
  });
});

describe("validarCuantas", () => {
  it("acepta un entero dentro del rango y devuelve el número", () => {
    expect(validarCuantas("20")).toEqual({ valor: 20 });
    expect(validarCuantas("  7  ")).toEqual({ valor: 7 });
  });

  it("acepta los dos extremos: 0 y el máximo", () => {
    expect(validarCuantas("0")).toEqual({ valor: 0 });
    expect(validarCuantas(String(MAXIMO_TAMANO_SESION))).toEqual({
      valor: MAXIMO_TAMANO_SESION,
    });
  });

  it("rechaza el campo vacío en vez de tomarlo por un 0", () => {
    expect(validarCuantas("")).toEqual({ error: MENSAJE_RANGO });
    expect(validarCuantas("   ")).toEqual({ error: MENSAJE_RANGO });
  });

  it("rechaza negativos, decimales y lo que no es un número", () => {
    expect(validarCuantas("-1")).toEqual({ error: MENSAJE_RANGO });
    expect(validarCuantas("2,5")).toEqual({ error: MENSAJE_RANGO });
    expect(validarCuantas("2.5")).toEqual({ error: MENSAJE_RANGO });
    expect(validarCuantas("veinte")).toEqual({ error: MENSAJE_RANGO });
  });

  it("rechaza un número por encima del máximo", () => {
    expect(validarCuantas(String(MAXIMO_TAMANO_SESION + 1))).toEqual({
      error: MENSAJE_RANGO,
    });
  });
});

describe("ETIQUETA_MODO", () => {
  it("los tres modos tienen nombre en español", () => {
    expect(ETIQUETA_MODO["no-aprendidas"]).toBe("No aprendidas");
    expect(ETIQUETA_MODO.aprendidas).toBe("Aprendidas");
    expect(ETIQUETA_MODO.mezcla).toBe("Mezcla");
  });
});
