import { describe, it, expect } from "vitest";
import {
  disponibles,
  puedeEmpezar,
  validarCuantas,
  resumenLegible,
  modoDisponible,
  modoParaSeguir,
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

describe("resumenLegible", () => {
  it("una sola palabra hoy va en singular", () => {
    // El último repaso del día, todos los días: antes decía "Hoy tienes 1
    // palabras".
    expect(resumenLegible(resumen({ sinAprender: 1, aprendidas: 0 })).titulo).toBe(
      "Hoy tienes 1 palabra",
    );
    expect(resumenLegible(resumen({ sinAprender: 0, aprendidas: 1 })).titulo).toBe(
      "Hoy tienes 1 palabra",
    );
  });

  it("de dos en adelante, plural", () => {
    expect(resumenLegible(resumen({ sinAprender: 5, aprendidas: 18 })).titulo).toBe(
      "Hoy tienes 23 palabras",
    );
  });

  it("el detalle reparte las dos colecciones y también concuerda", () => {
    expect(resumenLegible(resumen({ sinAprender: 5, aprendidas: 18 })).detalle).toBe(
      "5 sin aprender · 18 aprendidas",
    );
    expect(resumenLegible(resumen({ sinAprender: 1, aprendidas: 1 })).detalle).toBe(
      "1 sin aprender · 1 aprendida",
    );
    expect(resumenLegible(resumen({ sinAprender: 0, aprendidas: 2 })).detalle).toBe(
      "0 sin aprender · 2 aprendidas",
    );
  });

  it("sin nada para hoy no cuenta ceros: cambia de frase", () => {
    const legible = resumenLegible(
      resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 9, aprendidas: 4 }),
    );
    expect(legible.titulo).toBe("Hoy no toca ninguna palabra");
    expect(legible.detalle).toContain("pon un número");
  });

  it("solo mira lo de hoy, no la biblioteca entera", () => {
    const legible = resumenLegible(
      resumen({ sinAprender: 1, aprendidas: 0 }, { sinAprender: 100, aprendidas: 200 }),
    );
    expect(legible.titulo).toBe("Hoy tienes 1 palabra");
    expect(legible.detalle).toBe("1 sin aprender · 0 aprendidas");
  });
});

describe("modoDisponible", () => {
  it("respeta el modo elegido mientras tenga material", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    for (const modo of MODOS) {
      expect(modoDisponible(r, modo, 0)).toBe(modo);
    }
  });

  it("se mueve a uno que sí puede cuando el elegido se queda vacío", () => {
    // El caso de todos los días: quien guardó "No aprendidas" agota el cupo
    // diario de nuevas y vuelve a entrar. Antes ese modo salía marcado y
    // desactivado a la vez, con "Empezar" en gris y sin explicación.
    const r = resumen({ sinAprender: 0, aprendidas: 18 });
    expect(modoDisponible(r, "no-aprendidas", 0)).toBe("aprendidas");
  });

  it("el modo que devuelve siempre se puede empezar, si alguno se puede", () => {
    const casos = [
      resumen({ sinAprender: 0, aprendidas: 18 }),
      resumen({ sinAprender: 4, aprendidas: 0 }),
      resumen({ sinAprender: 2, aprendidas: 7 }),
    ];
    for (const r of casos) {
      for (const modo of MODOS) {
        expect(puedeEmpezar(r, modoDisponible(r, modo, 0), 0)).toBe(true);
      }
    }
  });

  it("con la biblioteca vacía se queda con el elegido", () => {
    // No hay ninguno mejor al que ir, y cambiar de modo por cambiar movería la
    // elección del usuario sin darle nada a cambio.
    const r = resumen({ sinAprender: 0, aprendidas: 0 });
    for (const modo of MODOS) {
      expect(modoDisponible(r, modo, 0)).toBe(modo);
    }
  });

  it("el número también cuenta: lo adelantable puede rescatar un modo", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 7 });
    expect(modoDisponible(r, "no-aprendidas", 0)).toBe("no-aprendidas");
    expect(modoDisponible(r, "no-aprendidas", 5)).toBe("aprendidas");
  });
});

describe("modoParaSeguir", () => {
  it('"no aprendidas" no puede traer los repasos que dejó fuera: se sigue con "aprendidas"', () => {
    // `repasosFuera` cuenta repasos vencidos fuera de la sesión. En este modo
    // los deja fuera el modo mismo, no ningún límite: repetirlo daría una cola
    // vacía una y otra vez.
    expect(modoParaSeguir("no-aprendidas")).toBe("aprendidas");
  });

  it("los otros dos modos sí los traen: se sigue con el mismo", () => {
    expect(modoParaSeguir("aprendidas")).toBe("aprendidas");
    expect(modoParaSeguir("mezcla")).toBe("mezcla");
  });

  it("nunca devuelve el modo que no puede traer repasos vencidos", () => {
    for (const modo of MODOS) {
      expect(modoParaSeguir(modo)).not.toBe("no-aprendidas");
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
