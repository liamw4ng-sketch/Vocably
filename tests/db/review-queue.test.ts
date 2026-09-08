import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { anadirDesdeDiccionario } from "@/db/repository/diccionario";
import { setNewCardsPerDay, setSessionSize, setSessionMode } from "@/db/repository/settings";
import {
  getDueQueue,
  formatearPlazo,
  applyAnswer,
  type OpcionesCola,
} from "@/db/repository/review";
import { cardStates, terms } from "@/db/schema";
import { eq } from "drizzle-orm";

let db: TestDb;
let closeDb: () => Promise<void>;
const AHORA = new Date("2026-09-10T09:00:00Z");
/** El día anterior a AHORA, también en horario de trabajo (11:00 en Madrid). */
const AYER = new Date("2026-09-09T09:00:00Z");
/** 23:30 UTC del día 9: ya es la 1:30 del día 10 en Madrid. */
const DE_MADRUGADA = new Date("2026-09-09T23:30:00Z");

const base = {
  title: "Libro A",
  pageStart: 1,
  pageEnd: 5,
  level: "B2",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

function termino(n: number, type = "word") {
  return {
    term: `palabra${n}`,
    type: type as "word" | "phrasal_verb" | "expression",
    translation: `traducción${n}`,
    context: `Frase con palabra${n}.`,
    example: `Ejemplo con palabra${n}.`,
  };
}

/** Deja esos términos como palabras ya aprendidas y vencidas desde hace días. */
async function madurar(termIds: number[], due = new Date("2026-09-08T09:00:00Z")) {
  for (const termId of termIds) {
    await db.update(cardStates).set({ state: 2, reps: 3, due }).where(eq(cardStates.termId, termId));
  }
}

/** Deja esos términos en aprendizaje (fallados hace poco) y ya vencidos. */
async function enAprendizaje(termIds: number[]) {
  for (const termId of termIds) {
    await db
      .update(cardStates)
      .set({ state: 1, reps: 1, due: new Date("2026-09-10T08:50:00Z") })
      .where(eq(cardStates.termId, termId));
  }
}

/** Deja esos términos como aprendidas que aún NO vencen. */
async function aprendidaFutura(termId: number, due: Date) {
  await db.update(cardStates).set({ state: 2, reps: 3, due }).where(eq(cardStates.termId, termId));
}

/**
 * `saveExtraction` guarda una extracción completa (fuente + términos) pero no
 * devuelve los `termId` que crea. Las pruebas de esta sección necesitan
 * manipular tarjetas concretas por id, así que se consultan aparte por su
 * texto justo después de guardar, en el mismo orden que `items`.
 */
async function guardarConIds(items: ReturnType<typeof termino>[]) {
  await saveExtraction(db, { ...base, items });
  const filas = await db.select({ id: terms.id, term: terms.term }).from(terms);
  const porTermino = new Map(filas.map((f) => [f.term, f.id]));
  return { termIds: items.map((it) => porTermino.get(it.term)!) };
}

/** Pseudoaleatorio determinista: la misma semilla da siempre el mismo sorteo. */
function generador(semilla: number): () => number {
  let x = semilla;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/** Atajo: casi todas las pruebas solo miran las cartas, no el recuento de las que quedan fuera. */
async function cartasDe(opts: OpcionesCola) {
  return (await getDueQueue(db, opts)).cartas;
}

/** Responde "Bien" a cada carta de la cola, como haría una sesión terminada. */
async function responder(cola: { termId: number }[], cuando: Date = AHORA) {
  for (const carta of cola) {
    await applyAnswer(db, {
      answerId: `${cuando.toISOString()}-${carta.termId}`,
      termId: carta.termId,
      rating: 3,
      now: cuando,
    });
  }
}

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

describe("getDueQueue", () => {
  it("respeta el tope de tarjetas nuevas", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 30 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 20);

    const cola = await cartasDe({ now: AHORA });
    expect(cola).toHaveLength(20);
    expect(cola.every((c) => c.esNueva)).toBe(true);
  });

  it("incluye las vencidas además de las nuevas, sin contarlas en el tope", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2), termino(3)] });
    await setNewCardsPerDay(db, 1);
    // palabra1 pasa a estar vencida: ya no es nueva
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-09-09T09:00:00Z") })
      .where(eq(cardStates.termId, 1));

    const cola = await cartasDe({ now: AHORA });
    expect(cola.filter((c) => !c.esNueva)).toHaveLength(1);
    expect(cola.filter((c) => c.esNueva)).toHaveLength(1);
  });

  it("excluye lo que aún no vence", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-12-01T00:00:00Z") })
      .where(eq(cardStates.termId, 1));

    expect(await cartasDe({ now: AHORA })).toHaveLength(0);
  });

  it("filtra por tipo de término", async () => {
    await saveExtraction(db, {
      ...base,
      items: [termino(1, "word"), termino(2, "phrasal_verb")],
    });
    const cola = await cartasDe({ now: AHORA, type: "phrasal_verb" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("filtra por fuente", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await saveExtraction(db, { ...base, title: "Libro B", items: [termino(2)] });

    const cola = await cartasDe({ now: AHORA, source: "Libro B" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("trae el contexto y el ejemplo de cada término", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await cartasDe({ now: AHORA });
    expect(carta.context).toBe("Frase con palabra1.");
    expect(carta.example).toBe("Ejemplo con palabra1.");
    expect(carta.translation).toBe("traducción1");
  });

  it("cuando un término tiene apariciones en dos fuentes, usa la primera (menor id) como desempate", async () => {
    // saveExtraction fusiona por término normalizado: guardar "palabra1" una
    // segunda vez bajo otro título no crea un segundo término, crea una
    // segunda fila en term_occurrences apuntando al mismo termId.
    //
    // Se intercalan muchos términos de relleno entre las dos apariciones de
    // "palabra1" a propósito: con pocas filas el motor tiende a devolver las
    // filas en su orden de inserción por pura coincidencia, sin que ningún
    // ORDER BY lo garantice, y esta prueba pasaría igual con o sin el
    // desempate explícito. Con suficiente volumen el planificador cambia de
    // estrategia y ese orden accidental se rompe (comprobado empíricamente:
    // sin el ORDER BY sobre term_occurrences.id, este mismo escenario hace
    // que la segunda aparición —con mayor id— aparezca antes que la
    // primera), que es exactamente el caso que el desempate debe cubrir.
    await saveExtraction(db, {
      ...base,
      title: "Libro A",
      items: [
        {
          ...termino(1),
          context: "Primera aparición de palabra1.",
          example: "Primer ejemplo de palabra1.",
        },
      ],
    });
    for (let i = 0; i < 50; i++) {
      await saveExtraction(db, { ...base, title: `Relleno-${i}`, items: [termino(100 + i)] });
    }
    await saveExtraction(db, {
      ...base,
      title: "Libro B",
      items: [
        {
          ...termino(1),
          context: "Segunda aparición de palabra1.",
          example: "Segundo ejemplo de palabra1.",
        },
      ],
    });
    await setNewCardsPerDay(db, 200); // que el tope no recorte el relleno

    const cola = await cartasDe({ now: AHORA });
    const entradas = cola.filter((c) => c.term === "palabra1");

    // Una sola entrada en la cola pese a las dos apariciones.
    expect(entradas).toHaveLength(1);
    // Y su contexto/ejemplo son los de la aparición con menor id
    // (la primera guardada), no un orden arbitrario de SQL.
    expect(entradas[0].context).toBe("Primera aparición de palabra1.");
    expect(entradas[0].example).toBe("Primer ejemplo de palabra1.");
  });

  it("con la biblioteca vacía devuelve una cola vacía", async () => {
    expect(await cartasDe({ now: AHORA })).toEqual([]);
  });

  it("trae los cuatro plazos, y el de Fácil es más lejano que el de Otra vez", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await cartasDe({ now: AHORA });

    expect(Object.keys(carta.plazos).sort()).toEqual(["1", "2", "3", "4"]);
    for (const p of Object.values(carta.plazos)) expect(p).toMatch(/\S/);
    // "1 min" contra "8 días": el texto difiere, que es lo que verá el usuario
    expect(carta.plazos[4]).not.toBe(carta.plazos[1]);
    // Valores exactos para una tarjeta nueva, según ts-fsrs 5.4.2: hechos de
    // la librería verificados por ejecución, no algo que la implementación
    // deba tener escrito a mano.
    expect(carta.plazos[1]).toBe("1 min");
    expect(carta.plazos[2]).toBe("6 min");
    expect(carta.plazos[3]).toBe("10 min");
    expect(carta.plazos[4]).toBe("8 días");
  });

  it("las tarjetas nuevas de hoy no se vuelven a repartir al recargar", async () => {
    // El fallo que esta prueba existe para impedir: responder el lote del día
    // saca esas tarjetas del estado "nueva", así que un tope aplicado sobre
    // "las que siguen siendo nuevas" reparte otro lote entero en cada
    // recarga, y otro, hasta agotar la biblioteca — en silencio.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    const primeras = await cartasDe({ now: AHORA });
    expect(primeras).toHaveLength(3);
    await responder(primeras);

    // Mismo instante: no ha cambiado el día, el cupo sigue gastado.
    expect(await cartasDe({ now: AHORA })).toHaveLength(0);
  });

  it("una tarjeta introducida ayer no gasta el cupo de hoy", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    const deAyer = await cartasDe({ now: AYER });
    expect(deAyer).toHaveLength(3);
    await responder(deAyer, AYER);

    // Hoy vuelve a haber cupo entero: tres palabras nuevas más. (Las tres de
    // ayer vuelven además como vencidas, que es lo correcto y no cuenta.)
    const hoy = await cartasDe({ now: AHORA });
    expect(hoy.filter((c) => c.esNueva)).toHaveLength(3);
  });

  it("el día empieza a medianoche en Madrid, no en UTC", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    // 23:30 UTC del día 9 es la 1:30 de la madrugada del día 10 en Madrid:
    // cuenta contra el cupo de HOY. Con el día calculado en UTC caería en
    // ayer y el cupo de hoy quedaría intacto.
    const [madrugada] = await cartasDe({ now: DE_MADRUGADA });
    await responder([madrugada], DE_MADRUGADA);

    const hoy = await cartasDe({ now: AHORA });
    expect(hoy.filter((c) => c.esNueva)).toHaveLength(2);
  });

  it("lo vencido llega entero aunque el cupo de nuevas esté gastado", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    // Tres términos maduros y vencidos desde hace días.
    for (const termId of [1, 2, 3]) {
      await db
        .update(cardStates)
        .set({ state: 2, reps: 3, due: new Date("2026-09-08T09:00:00Z") })
        .where(eq(cardStates.termId, termId));
    }
    await setNewCardsPerDay(db, 2);

    const primera = await cartasDe({ now: AHORA });
    expect(primera.filter((c) => !c.esNueva)).toHaveLength(3);
    expect(primera.filter((c) => c.esNueva)).toHaveLength(2);

    // Se responden solo las nuevas: el cupo del día queda gastado y las tres
    // vencidas siguen vencidas.
    await responder(primera.filter((c) => c.esNueva));

    const segunda = await cartasDe({ now: AHORA });
    expect(segunda.filter((c) => c.esNueva)).toHaveLength(0);
    expect(segunda).toHaveLength(3);
  });

  it("una tarjeta ya respondida hoy no vuelve a la cola al recargar", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2)] });
    expect(await cartasDe({ now: AHORA })).toHaveLength(2);

    await applyAnswer(db, { answerId: "r1", termId: 1, rating: 3, now: AHORA });

    const cola = await cartasDe({ now: AHORA });
    expect(cola.map((c) => c.termId)).toEqual([2]);
  });

  it("con los repasos por sesión a 0 no se recorta nada", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await madurar([1, 2, 3, 4, 5, 6, 7, 8]);
    await setNewCardsPerDay(db, 0);

    const { cartas, repasosFuera } = await getDueQueue(db, { now: AHORA });
    expect(cartas).toHaveLength(8);
    expect(repasosFuera).toBe(0);
  });

  it("recorta los repasos al número pedido y dice cuántos quedan fuera", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await madurar([1, 2, 3, 4, 5, 6, 7, 8]);
    await setNewCardsPerDay(db, 0);
    await setSessionSize(db, 3);

    const { cartas, repasosFuera } = await getDueQueue(db, { now: AHORA, aleatorio: generador(1) });
    expect(cartas).toHaveLength(3);
    expect(repasosFuera).toBe(5);
  });

  it("las que quedan fuera siguen vencidas y salen en la sesión siguiente", async () => {
    // El recorte reparte el trabajo, no lo tira: es la diferencia entre un
    // límite por sesión y perder repasos.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await madurar([1, 2, 3, 4, 5, 6]);
    await setNewCardsPerDay(db, 0);
    await setSessionSize(db, 2);

    const primera = (await getDueQueue(db, { now: AHORA, aleatorio: generador(1) })).cartas;
    expect(primera).toHaveLength(2);
    await responder(primera);

    const segunda = (await getDueQueue(db, { now: AHORA, aleatorio: generador(2) })).cartas;
    expect(segunda).toHaveLength(2);
    const yaVistas = primera.map((c) => c.termId);
    expect(segunda.some((c) => yaVistas.includes(c.termId))).toBe(false);
  });

  it("las palabras que estás repitiendo no entran en el sorteo ni se recortan", async () => {
    // Una palabra en aprendizaje o reaprendizaje es una que acabas de fallar
    // y que el programa quiere volver a preguntarte en minutos. Dejarla fuera
    // por el límite es lo único que sí rompería la repetición espaciada.
    //
    // El tamaño de sesión es ahora un total (lo compone `componerSesion`), no
    // un límite que solo tocaba los repasos: se pide cupo para las dos en
    // curso más dos vencidas, para poder comprobar que las en curso van
    // enteras y sin sortear aunque compitan por el mismo cupo.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await madurar([1, 2, 3, 4, 5]);
    await enAprendizaje([6, 7]);
    await setSessionSize(db, 4);

    for (const semilla of [1, 2, 3, 4, 5]) {
      const { cartas, repasosFuera } = await getDueQueue(db, {
        now: AHORA,
        aleatorio: generador(semilla),
      });
      expect(cartas).toHaveLength(4);
      expect(cartas.map((c) => c.termId)).toEqual(expect.arrayContaining([6, 7]));
      // El recuento de las que quedan fuera cuenta solo aprendidas: 5 - 2.
      expect(repasosFuera).toBe(3);
    }
  });

  it("el sorteo puede elegir a cualquiera de las vencidas", async () => {
    // Sin esto, un recorte que siempre se quedara con las primeras por id
    // pasaría todas las pruebas de arriba, y el usuario repasaría siempre las
    // mismas tres palabras mientras las demás envejecen.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await madurar([1, 2, 3, 4, 5, 6, 7, 8]);
    await setNewCardsPerDay(db, 0);
    await setSessionSize(db, 3);

    const elegidas = new Set<number>();
    for (let semilla = 1; semilla <= 40; semilla++) {
      const { cartas } = await getDueQueue(db, { now: AHORA, aleatorio: generador(semilla) });
      for (const carta of cartas) elegidas.add(carta.termId);
    }
    expect([...elegidas].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("la cola trae la pista de la acepción", async () => {
    const { termId } = await anadirDesdeDiccionario(db, {
      term: "bank",
      pos: "noun",
      gloss: "An edge of a river.",
      example: "We sat on the bank.",
      translation: "orilla",
      level: "B1",
    });
    await madurar([termId]);

    const { cartas } = await getDueQueue(db, { now: AHORA });
    expect(cartas).toHaveLength(1);
    expect(cartas[0].senseHint).toBe("An edge of a river.");
  });

  it("lo extraído de un PDF no lleva pista", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [tarjeta] = await db.select().from(cardStates);
    await madurar([tarjeta.termId]);

    const { cartas } = await getDueQueue(db, { now: AHORA });
    expect(cartas[0].senseHint).toBe("");
  });
});

describe("modos de sesión", () => {
  it("no-aprendidas deja fuera los repasos vencidos", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2)]);
    await madurar([termIds[0]]);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas" });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[1]]);
  });

  it("aprendidas deja fuera las nuevas y las que están en curso", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    await madurar([termIds[0]]);
    await enAprendizaje([termIds[1]]);

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas" });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });
});

describe("adelantar aprendidas con un tamaño de sesión", () => {
  /**
   * La regresión que importa: antes de este cambio, una aprendida que aún no
   * vencía se caía del bucle de `getDueQueue` sin entrar en ningún grupo, así
   * que no había forma de adelantarla.
   */
  it("una aprendida que aún no vence entra si el número lo pide", async () => {
    const { termIds } = await guardarConIds([termino(1)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-20T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 5 });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });

  it("y NO entra con el número a 0, que promete no adelantar nada", async () => {
    const { termIds } = await guardarConIds([termino(1)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-20T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 0 });

    expect(cartas).toEqual([]);
  });

  it("se adelanta la más próxima primero", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-30T09:00:00Z"));
    await aprendidaFutura(termIds[1], new Date("2026-09-12T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 1 });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[1]]);
  });

  it("el número manda sobre el tope diario de tarjetas nuevas", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    await setNewCardsPerDay(db, 1);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas", cuantas: 3 });

    expect(cartas).toHaveLength(3);
    expect(new Set(cartas.map((c) => c.termId))).toEqual(new Set(termIds));
  });

  it("con el número a 0 el tope diario sigue mandando", async () => {
    await guardarConIds([termino(1), termino(2), termino(3)]);
    await setNewCardsPerDay(db, 1);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas", cuantas: 0 });

    expect(cartas).toHaveLength(1);
  });
});

describe("el modo y el número salen de los ajustes si no se piden", () => {
  it("usa el tamaño guardado cuando la llamada no trae número", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    await madurar(termIds);
    await setSessionSize(db, 2);

    const cartas = await cartasDe({ now: AHORA });

    expect(cartas).toHaveLength(2);
  });

  it("usa el modo guardado cuando la llamada no trae modo", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2)]);
    await madurar([termIds[0]]);
    await setSessionMode(db, "aprendidas");

    const cartas = await cartasDe({ now: AHORA });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });
});

describe("formatearPlazo", () => {
  const desde = new Date("2026-09-10T09:00:00Z");
  const tras = (ms: number) => new Date(desde.getTime() + ms);
  const MIN = 60_000;
  const HORA = 60 * MIN;
  const DIA = 24 * HORA;

  it("bajo un minuto: 'ahora'", () => {
    expect(formatearPlazo(desde, tras(10_000))).toBe("ahora");
  });

  it("59 minutos frente a 60 minutos (pasa a horas)", () => {
    expect(formatearPlazo(desde, tras(59 * MIN))).toBe("59 min");
    expect(formatearPlazo(desde, tras(60 * MIN))).toBe("1 h");
  });

  it("23 horas frente a 24 horas (pasa a días)", () => {
    expect(formatearPlazo(desde, tras(23 * HORA))).toBe("23 h");
    expect(formatearPlazo(desde, tras(24 * HORA))).toBe("1 día");
  });

  it("el caso singular: 1 día (frente a 2 días, en plural)", () => {
    expect(formatearPlazo(desde, tras(1 * DIA))).toBe("1 día");
    expect(formatearPlazo(desde, tras(2 * DIA))).toBe("2 días");
  });

  it("29 días frente a 30 días (pasa a meses, y 30 días es '1 mes' sin decimal)", () => {
    expect(formatearPlazo(desde, tras(29 * DIA))).toBe("29 días");
    expect(formatearPlazo(desde, tras(30 * DIA))).toBe("1 mes");
  });

  it("11 meses frente a 12 meses (pasa a años, y 365 días es '1 año' sin decimal)", () => {
    expect(formatearPlazo(desde, tras(360 * DIA))).toBe("11,8 meses");
    expect(formatearPlazo(desde, tras(365 * DIA))).toBe("1 año");
  });

  it("formatea con un decimal cuando no es un número redondo", () => {
    expect(formatearPlazo(desde, tras(40 * DIA))).toBe("1,3 meses");
    expect(formatearPlazo(desde, tras(61 * DIA))).toBe("2 meses");
    expect(formatearPlazo(desde, tras(550 * DIA))).toBe("1,5 años");
  });
});
