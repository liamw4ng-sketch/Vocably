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

    expect(ids(cartas)).toEqual([1, 2, 3, 4, 5]);
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

    expect(ids(cartas)).toEqual([1, 2, 3]);
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
   * El sorteo solo actúa donde hay que elegir. Con `aleatorio` fijado se puede
   * comprobar el resultado exacto, no solo la longitud.
   */
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

  it("no toca el orden si caben todas", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3]);
  });

  it("las en curso nunca entran en el sorteo: van en orden y enteras", () => {
    const { cartas } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 3, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3]);
  });

  it("las adelantadas van por orden de llegada, que es el de vencimiento", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasFuturas: [carta(7), carta(8), carta(9)] }),
      { modo: "aprendidas", cuantas: 2, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([7, 8]);
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

    expect(ids(cartas)).toEqual([1]);
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
