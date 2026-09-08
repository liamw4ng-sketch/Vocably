import { describe, it, expect } from "vitest";
import { disponibles, puedeEmpezar, ETIQUETA_MODO } from "@/components/SesionRepaso";
import { MODOS } from "@/lib/ajustes";
import type { ResumenColecciones } from "@/db/repository/review";

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

describe("ETIQUETA_MODO", () => {
  it("los tres modos tienen nombre en español", () => {
    expect(ETIQUETA_MODO["no-aprendidas"]).toBe("No aprendidas");
    expect(ETIQUETA_MODO.aprendidas).toBe("Aprendidas");
    expect(ETIQUETA_MODO.mezcla).toBe("Mezcla");
  });
});
