import { describe, it, expect } from "vitest";
import {
  disponibles,
  puedeEmpezar,
  validarCuantas,
  resumenLegible,
  bibliotecaVacia,
  todoEnAprendizaje,
  modoDisponible,
  modoParaSeguir,
  etiquetaSeguir,
  vencidosFuera,
  mensajeVencidosFuera,
  ajustesARecordar,
  ETIQUETA_MODO,
} from "@/components/SesionRepaso";
import { MODOS, MAXIMO_TAMANO_SESION } from "@/lib/ajustes";
import { componerSesion } from "@/lib/repaso/coleccion";
import type { ResumenColecciones, VencidosFuera } from "@/db/repository/review";

/** El único mensaje de error que da `validarCuantas`, sea cual sea el motivo. */
const MENSAJE_RANGO = `Debe ser un número entero entre 0 y ${MAXIMO_TAMANO_SESION}.`;

/**
 * Por defecto la biblioteca es lo que suman los contadores totales, que es el
 * caso corriente. Las pruebas que separan las dos cosas pasan el tercer
 * argumento a mano.
 */
function resumen(
  hoy: { sinAprender: number; aprendidas: number },
  total = hoy,
  biblioteca = total.sinAprender + total.aprendidas,
): ResumenColecciones {
  return { hoy, total, biblioteca };
}

const SOLO_APRENDIDAS: VencidosFuera = { repasosFuera: 2, enCursoFuera: 0 };
const SOLO_EN_CURSO: VencidosFuera = { repasosFuera: 0, enCursoFuera: 2 };
const LAS_DOS: VencidosFuera = { repasosFuera: 2, enCursoFuera: 2 };
const NADA_FUERA: VencidosFuera = { repasosFuera: 0, enCursoFuera: 0 };

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

  it("sin nada para hoy pero con algo que adelantar sigue ofreciendo el número", () => {
    // Y la oferta es cierta: con un número, los modos tienen material.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 4 });
    expect(resumenLegible(r).detalle).toContain("pon un número");
    expect(disponibles(r, "aprendidas", 4)).toBe(4);
    expect(puedeEmpezar(r, "mezcla", 4)).toBe(true);
  });

  it("con la biblioteca entera en aprendizaje no dice que estés al día ni ofrece adelantar", () => {
    // La reproducción: una sesión respondida entera con "Otra vez". No hay
    // nada vencido y tampoco nada que adelantar, así que "pon un número" no
    // haría nada —los tres modos salen a (0)— y "estás al día" es falso: las
    // palabras vuelven en cuanto pase su paso de aprendizaje.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 3);
    const legible = resumenLegible(r);
    expect(legible.titulo).toBe("Ahora mismo no toca ninguna palabra");
    expect(legible.detalle).toBe(
      "Las que estás aprendiendo vuelven en unos minutos. No hay nada que adelantar: vuelve a esta pantalla dentro de un rato.",
    );
    expect(legible.detalle).not.toContain("pon un número");
    expect(legible.detalle).not.toContain("al día");
    // Por qué no puede ofrecerlo: no hay número que saque nada.
    for (const modo of MODOS) {
      for (const cuantas of [0, 1, MAXIMO_TAMANO_SESION]) {
        expect(disponibles(r, modo, cuantas)).toBe(0);
      }
    }
  });

  it("con la biblioteca vacía no habla de palabras en aprendizaje", () => {
    // Ese caso no llega a esta frase —la pantalla enseña la de "no tienes
    // ninguna palabra todavía"—, pero la función no debe inventarse palabras
    // que no existen si alguien la llama igualmente.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 0);
    expect(bibliotecaVacia(r)).toBe(true);
    expect(resumenLegible(r).titulo).not.toBe("Ahora mismo no toca ninguna palabra");
  });

  it("solo mira lo de hoy, no la biblioteca entera", () => {
    const legible = resumenLegible(
      resumen({ sinAprender: 1, aprendidas: 0 }, { sinAprender: 100, aprendidas: 200 }),
    );
    expect(legible.titulo).toBe("Hoy tienes 1 palabra");
    expect(legible.detalle).toBe("1 sin aprender · 0 aprendidas");
  });
});

describe("bibliotecaVacia", () => {
  it("los contadores a cero no significan biblioteca vacía", () => {
    // La reproducción: tres palabras respondidas "Otra vez". Quedan en
    // aprendizaje y sin vencer, y ni `hoy` ni `total` las ven —a propósito,
    // porque la cola tampoco las serviría—. Deducir de ahí que no hay
    // vocabulario mandaba a la usuaria a añadir palabras que ya tenía.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 3);
    expect(bibliotecaVacia(r)).toBe(false);
  });

  it("sin ninguna tarjeta sí está vacía", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 0);
    expect(bibliotecaVacia(r)).toBe(true);
  });

  it("con material para hoy tampoco está vacía", () => {
    expect(bibliotecaVacia(resumen({ sinAprender: 2, aprendidas: 1 }))).toBe(false);
  });
});

describe("todoEnAprendizaje", () => {
  it("es cierto con la biblioteca llena y nada que servir", () => {
    // Tres palabras falladas hace medio minuto: en aprendizaje y sin vencer.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 3);
    expect(todoEnAprendizaje(r)).toBe(true);
  });

  it("es falso si queda algo que adelantar, aunque hoy no toque nada", () => {
    // Aquí "pon un número" sí funciona, y tiene que seguir funcionando.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 7 }, 7);
    expect(todoEnAprendizaje(r)).toBe(false);
    expect(puedeEmpezar(r, "aprendidas", 3)).toBe(true);
  });

  it("es falso con nuevas pendientes por encima del tope diario", () => {
    // `hoy` está a cero porque el cupo se gastó, pero un número explícito se
    // salta el tope: hay material.
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 5, aprendidas: 0 }, 5);
    expect(todoEnAprendizaje(r)).toBe(false);
  });

  it("es falso con la biblioteca vacía: eso es no tener vocabulario, no tenerlo a medias", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 0 }, 0);
    expect(todoEnAprendizaje(r)).toBe(false);
    expect(bibliotecaVacia(r)).toBe(true);
  });

  it("es falso con material para hoy", () => {
    expect(todoEnAprendizaje(resumen({ sinAprender: 2, aprendidas: 1 }))).toBe(false);
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

describe("vencidosFuera", () => {
  it("suma las dos colecciones: lo que queda pendiente hoy es lo mismo venga de donde venga", () => {
    expect(vencidosFuera({ repasosFuera: 2, enCursoFuera: 3 })).toBe(5);
    expect(vencidosFuera(NADA_FUERA)).toBe(0);
  });

  it("una sola pendiente va en singular", () => {
    expect(mensajeVencidosFuera({ repasosFuera: 0, enCursoFuera: 1 })).toBe(
      "Queda 1 repaso más para hoy que no entró en esta sesión.",
    );
    expect(mensajeVencidosFuera({ repasosFuera: 1, enCursoFuera: 0 })).toBe(
      "Queda 1 repaso más para hoy que no entró en esta sesión.",
    );
  });

  it("de dos en adelante, plural, y cuenta las dos juntas", () => {
    expect(mensajeVencidosFuera({ repasosFuera: 1, enCursoFuera: 2 })).toBe(
      "Quedan 3 repasos más para hoy que no entraron en esta sesión.",
    );
  });
});

describe("modoParaSeguir", () => {
  it('"no aprendidas" no puede traer los repasos de aprendidas que dejó fuera: se sigue con "aprendidas"', () => {
    // En ese modo los deja fuera el modo mismo, no ningún límite: repetirlo
    // daría una cola vacía una y otra vez.
    expect(modoParaSeguir("no-aprendidas", SOLO_APRENDIDAS)).toBe("aprendidas");
  });

  it("los otros dos modos sí traen las aprendidas: se sigue con el mismo", () => {
    expect(modoParaSeguir("aprendidas", SOLO_APRENDIDAS)).toBe("aprendidas");
    expect(modoParaSeguir("mezcla", SOLO_APRENDIDAS)).toBe("mezcla");
  });

  it("si lo que queda son palabras en curso, se sigue con un modo que las traiga", () => {
    // "Aprendidas" nunca cuela una en curso, ni vencida: seguir con ese modo
    // sería el mismo bucle vacío, solo que en la otra dirección.
    expect(modoParaSeguir("aprendidas", SOLO_EN_CURSO)).toBe("no-aprendidas");
    expect(modoParaSeguir("no-aprendidas", SOLO_EN_CURSO)).toBe("no-aprendidas");
    expect(modoParaSeguir("mezcla", SOLO_EN_CURSO)).toBe("mezcla");
  });

  it("si quedan de las dos colecciones, solo mezcla las alcanza", () => {
    for (const modo of MODOS) {
      expect(modoParaSeguir(modo, LAS_DOS)).toBe("mezcla");
    }
  });

  it("el modo con el que se sigue siempre trae algo: nunca es un botón en bucle", () => {
    // Se compone de verdad la sesión siguiente con lo que quedó pendiente. Si
    // el modo elegido no cubriera la colección que tiene pendientes,
    // `componerSesion` devolvería una lista vacía y el botón repetiría la misma
    // pantalla para siempre.
    for (const fuera of [SOLO_APRENDIDAS, SOLO_EN_CURSO, LAS_DOS]) {
      for (const modo of MODOS) {
        for (const cuantas of [0, 1]) {
          const { cartas } = componerSesion(
            {
              enCurso: Array.from({ length: fuera.enCursoFuera }, (_, i) => ({ id: 100 + i })),
              nuevas: [],
              aprendidasVencidas: Array.from({ length: fuera.repasosFuera }, (_, i) => ({
                id: 200 + i,
              })),
              aprendidasFuturas: [],
            },
            { modo: modoParaSeguir(modo, fuera), cuantas, limiteNuevas: 0 },
          );
          expect(cartas.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("el botón dice a qué colección se sigue cuando cambia", () => {
    // El texto vivía escrito a mano dentro del JSX, que es lo mismo que
    // produjo "Hoy tienes 1 palabras". Aquí se puede leer.
    expect(etiquetaSeguir("no-aprendidas", SOLO_APRENDIDAS)).toBe('Seguir con "Aprendidas"');
    expect(etiquetaSeguir("aprendidas", SOLO_EN_CURSO)).toBe('Seguir con "No aprendidas"');
    expect(etiquetaSeguir("aprendidas", LAS_DOS)).toBe('Seguir con "Mezcla"');
  });

  it("sin cambio de colección, el botón dice lo de siempre", () => {
    expect(etiquetaSeguir("aprendidas", SOLO_APRENDIDAS)).toBe("Seguir repasando");
    expect(etiquetaSeguir("mezcla", SOLO_APRENDIDAS)).toBe("Seguir repasando");
    expect(etiquetaSeguir("no-aprendidas", SOLO_EN_CURSO)).toBe("Seguir repasando");
  });

  it("el nombre que enseña es el mismo del botón de la pantalla previa", () => {
    // Dos nombres distintos para la misma colección serían dos colecciones a
    // ojos del usuario.
    for (const fuera of [SOLO_APRENDIDAS, SOLO_EN_CURSO, LAS_DOS]) {
      for (const modo of MODOS) {
        const etiqueta = etiquetaSeguir(modo, fuera);
        if (etiqueta !== "Seguir repasando") {
          expect(etiqueta).toBe(`Seguir con "${ETIQUETA_MODO[modoParaSeguir(modo, fuera)]}"`);
        }
      }
    }
  });
});

describe("ajustesARecordar", () => {
  it("sin haber tocado ningún modo, guarda el número y deja el modo como estaba", () => {
    // El caso que rompía: con "No aprendidas" guardado y el cupo del día
    // gastado, la pantalla cae a "Aprendidas". Marcar la casilla es querer
    // guardar el número que se acaba de teclear, no cambiar de colección para
    // siempre por una caída de hoy.
    expect(ajustesARecordar(20, "aprendidas", false)).toEqual({ sessionSize: 20 });
    expect("sessionMode" in ajustesARecordar(20, "aprendidas", false)).toBe(false);
  });

  it("con un modo pulsado, guarda los dos", () => {
    expect(ajustesARecordar(20, "aprendidas", true)).toEqual({
      sessionSize: 20,
      sessionMode: "aprendidas",
    });
  });

  it("el cero es un número como otro cualquiera", () => {
    // "0 = las que toquen hoy" es una elección legítima y la de fábrica: si se
    // cayera por ser falsy, no habría manera de volver a ella.
    expect(ajustesARecordar(0, "mezcla", true)).toEqual({
      sessionSize: 0,
      sessionMode: "mezcla",
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
