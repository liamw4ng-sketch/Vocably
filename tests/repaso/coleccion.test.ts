import { describe, it, expect } from "vitest";
import { coleccionDe, componerSesion, type Grupos } from "@/lib/repaso/coleccion";

/** Una carta de mentira: al composer solo le importa la identidad. */
function carta(id: number) {
  return { id };
}
type Carta = ReturnType<typeof carta>;

function grupos(parcial: Partial<Grupos<Carta>> = {}): Grupos<Carta> {
  return {
    enCurso: [],
    nuevas: [],
    aprendidasVencidas: [],
    aprendidasFuturas: [],
    ...parcial,
  };
}

const ids = (cartas: Carta[]) => cartas.map((c) => c.id);
/** Para lo que importa QUÉ cartas entran, no en qué orden: ahora se barajan. */
const idsOrdenados = (cartas: Carta[]) => ids(cartas).sort((a, b) => a - b);

describe("coleccionDe", () => {
  it("solo el estado Review cuenta como aprendida", () => {
    expect(coleccionDe(2)).toBe("aprendidas");
  });

  it("nueva, en aprendizaje y en reaprendizaje son la misma colección", () => {
    expect(coleccionDe(0)).toBe("no-aprendidas");
    expect(coleccionDe(1)).toBe("no-aprendidas");
    expect(coleccionDe(3)).toBe("no-aprendidas");
  });
});

describe("componerSesion, con cuantas = 0", () => {
  it("mezcla trae lo vencido entero y las nuevas hasta el tope diario", () => {
    const { cartas } = componerSesion(
      grupos({
        enCurso: [carta(1)],
        aprendidasVencidas: [carta(2), carta(3)],
        nuevas: [carta(4), carta(5), carta(6)],
      }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 2 },
    );

    expect(cartas).toHaveLength(5);
    // La en curso y las dos vencidas entran enteras; de las tres nuevas, dos.
    // Cuáles de las tres ya no se puede afirmar: el grupo se baraja.
    expect(idsOrdenados(cartas).filter((id) => id <= 3)).toEqual([1, 2, 3]);
    expect(cartas.filter((c) => c.id >= 4)).toHaveLength(2);
  });

  it("no adelanta nunca lo que aún no vencía", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], aprendidasFuturas: [carta(9)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1]);
  });
});

describe("componerSesion, con un número explícito", () => {
  it("recorta al número pedido", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3), carta(4)] }),
      { modo: "aprendidas", cuantas: 2, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(cartas).toHaveLength(2);
  });

  it("adelanta lo que aún no vencía hasta completar el número", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], aprendidasFuturas: [carta(8), carta(9)] }),
      { modo: "aprendidas", cuantas: 3, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1, 8, 9]);
  });

  it("ignora el tope diario de nuevas: manda el número", () => {
    const { cartas } = componerSesion(
      grupos({ nuevas: [carta(1), carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 3, limiteNuevas: 1 },
    );

    expect(idsOrdenados(cartas)).toEqual([1, 2, 3]);
  });

  it("si no hay material para el número, la sesión es más corta y no roba de la otra colección", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], nuevas: [carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 10, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1]);
  });
});

describe("componerSesion, los modos", () => {
  it("no-aprendidas deja fuera las aprendidas, vencidas o no", () => {
    const { cartas } = componerSesion(
      grupos({
        enCurso: [carta(1)],
        nuevas: [carta(2)],
        aprendidasVencidas: [carta(3)],
        aprendidasFuturas: [carta(4)],
      }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1, 2]);
  });

  it("aprendidas no cuela las que están en curso, aunque estén vencidas", () => {
    const { cartas } = componerSesion(
      grupos({ enCurso: [carta(1)], aprendidasVencidas: [carta(2)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([2]);
  });

  it("un modo cuya colección está vacía devuelve una sesión vacía, no revienta", () => {
    const { cartas } = componerSesion(grupos({ nuevas: [carta(1)] }), {
      modo: "aprendidas",
      cuantas: 5,
      limiteNuevas: 10,
    });

    expect(cartas).toEqual([]);
  });
});

describe("componerSesion, el sorteo", () => {
  /**
   * El usuario lo pidió después de usarlo: «siempre estaban en el mismo orden
   * al hacer los tests». Y lo estaban: las nuevas salían por orden de la
   * biblioteca —o sea, por el id del término— y solo se barajaba un grupo, y
   * solo cuando había que recortarlo. Ahora se barajan los tres grupos de
   * trabajo del día, siempre, entren enteros o recortados.
   *
   * Lo que NO se baraja son las adelantadas: su orden es el de vencimiento, y
   * es lo que hace que adelantar dos días seguidos no traiga lo mismo.
   */
  it("baraja las nuevas aunque entren todas", () => {
    const { cartas } = componerSesion(
      grupos({ nuevas: [carta(1), carta(2), carta(3), carta(4)] }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    // barajar([1,2,3,4], () => 0) rota a [2,3,4,1]: si alguien quita el sorteo,
    // esto vuelve a [1,2,3,4] y la prueba se pone roja.
    expect(ids(cartas)).toEqual([2, 3, 4, 1]);
  });

  it("baraja las en curso aunque entren todas", () => {
    const { cartas } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2), carta(3), carta(4)] }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([2, 3, 4, 1]);
  });

  it("baraja los repasos vencidos aunque entren todos", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3), carta(4)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([2, 3, 4, 1]);
  });

  it("sortea los repasos vencidos cuando hay que dejar alguno fuera", () => {
    const vencidas = [carta(1), carta(2), carta(3), carta(4)];
    const { cartas } = componerSesion(grupos({ aprendidasVencidas: vencidas }), {
      modo: "aprendidas",
      cuantas: 2,
      limiteNuevas: 10,
      aleatorio: () => 0,
    });

    // barajar() es determinístico cuando se inyecta aleatorio: barajar([1,2,3,4], () => 0)
    // rota el array a [2,3,4,1], así que slice(0,2) da exactamente [2, 3].
    // Verificamos que aleatorio() está conectado a barajar: el test falla si
    // la implementación no lo usa (p.ej. un .slice(-hueco) o .reverse() pasaría
    // pero daría otro resultado distinto).
    expect(ids(cartas)).toEqual([2, 3]);
  });

  /**
   * El sorteo es dentro de cada grupo, no entre grupos: primero lo que estás
   * aprendiendo, luego los repasos y luego lo nuevo. Barajarlo todo junto
   * mezclaría una palabra que fallaste hace diez minutos con una que no has
   * visto nunca, y son dos trabajos distintos.
   */
  it("baraja dentro de cada grupo, sin mezclar unos con otros", () => {
    const { cartas } = componerSesion(
      grupos({
        enCurso: [carta(1), carta(2)],
        aprendidasVencidas: [carta(3), carta(4)],
        nuevas: [carta(5), carta(6)],
      }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    // barajar de dos elementos con aleatorio() = 0 los intercambia.
    expect(ids(cartas)).toEqual([2, 1, 4, 3, 6, 5]);
  });

  it("las adelantadas van por orden de llegada, que es el de vencimiento", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasFuturas: [carta(7), carta(8), carta(9)] }),
      { modo: "aprendidas", cuantas: 2, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([7, 8]);
  });

  it("las adelantadas siguen sin barajarse aunque entren todas", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasFuturas: [carta(7), carta(8), carta(9), carta(10)] }),
      { modo: "aprendidas", cuantas: 4, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([7, 8, 9, 10]);
  });

  /** Sin tope, `limiteNuevas` llega como infinito: el `slice` tiene que aguantarlo. */
  it("sin tope entran todas las nuevas", () => {
    const { cartas } = componerSesion(
      grupos({ nuevas: [carta(1), carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: Number.POSITIVE_INFINITY },
    );

    expect(cartas).toHaveLength(3);
  });
});

describe("componerSesion, repasosFuera", () => {
  it("cuenta los repasos vencidos que el número dejó fuera", () => {
    const { repasosFuera } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 1, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(repasosFuera).toBe(2);
  });

  it("es cero cuando entran todos", () => {
    const { repasosFuera } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2)] }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 10 },
    );

    expect(repasosFuera).toBe(0);
  });

  it("en modo no-aprendidas cuenta todos los vencidos, porque el modo los deja fuera", () => {
    const { repasosFuera } = componerSesion(
      grupos({ nuevas: [carta(1)], aprendidasVencidas: [carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(repasosFuera).toBe(2);
  });
});

/**
 * Las "en curso" que entran aquí ya vencen todas (quien las reúne descarta las
 * que no), así que una que se queda fuera es trabajo pendiente de hoy exactamente
 * igual que un repaso de aprendidas. Antes no se contaba en ningún sitio, y la
 * pantalla de fin de sesión felicitaba por haber terminado con palabras falladas
 * hacía minutos ya vencidas y sin ningún botón que llevara a ellas.
 */
describe("componerSesion, enCursoFuera", () => {
  it("un número menor que las en curso las recorta y cuenta las que deja fuera", () => {
    const { cartas, enCursoFuera, repasosFuera } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2), carta(3)] }),
      { modo: "mezcla", cuantas: 1, limiteNuevas: 10 },
    );

    // Cuál de las tres entra es cosa del sorteo; que entre una sola, no.
    expect(cartas).toHaveLength(1);
    expect(enCursoFuera).toBe(2);
    expect(repasosFuera).toBe(0);
  });

  it("el modo aprendidas las descarta enteras y las cuenta", () => {
    const { cartas, enCursoFuera, repasosFuera } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2)], aprendidasVencidas: [carta(3)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([3]);
    expect(enCursoFuera).toBe(2);
    expect(repasosFuera).toBe(0);
  });

  it("es cero cuando entran todas", () => {
    const { enCursoFuera } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2)], aprendidasVencidas: [carta(3)] }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 10 },
    );

    expect(enCursoFuera).toBe(0);
  });

  it("las dos colecciones se cuentan por separado, no revueltas", () => {
    const { cartas, enCursoFuera, repasosFuera } = componerSesion(
      grupos({
        enCurso: [carta(1), carta(2)],
        aprendidasVencidas: [carta(3), carta(4), carta(5)],
      }),
      { modo: "mezcla", cuantas: 3, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(cartas).toHaveLength(3);
    expect(enCursoFuera).toBe(0);
    expect(repasosFuera).toBe(2);
  });
});
