import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay } from "@/db/repository/settings";
import { getDueQueue, formatearPlazo, applyAnswer } from "@/db/repository/review";
import { cardStates } from "@/db/schema";
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

    const cola = await getDueQueue(db, { now: AHORA });
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

    const cola = await getDueQueue(db, { now: AHORA });
    expect(cola.filter((c) => !c.esNueva)).toHaveLength(1);
    expect(cola.filter((c) => c.esNueva)).toHaveLength(1);
  });

  it("excluye lo que aún no vence", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-12-01T00:00:00Z") })
      .where(eq(cardStates.termId, 1));

    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(0);
  });

  it("filtra por tipo de término", async () => {
    await saveExtraction(db, {
      ...base,
      items: [termino(1, "word"), termino(2, "phrasal_verb")],
    });
    const cola = await getDueQueue(db, { now: AHORA, type: "phrasal_verb" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("filtra por fuente", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await saveExtraction(db, { ...base, title: "Libro B", items: [termino(2)] });

    const cola = await getDueQueue(db, { now: AHORA, source: "Libro B" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("trae el contexto y el ejemplo de cada término", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await getDueQueue(db, { now: AHORA });
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

    const cola = await getDueQueue(db, { now: AHORA });
    const entradas = cola.filter((c) => c.term === "palabra1");

    // Una sola entrada en la cola pese a las dos apariciones.
    expect(entradas).toHaveLength(1);
    // Y su contexto/ejemplo son los de la aparición con menor id
    // (la primera guardada), no un orden arbitrario de SQL.
    expect(entradas[0].context).toBe("Primera aparición de palabra1.");
    expect(entradas[0].example).toBe("Primer ejemplo de palabra1.");
  });

  it("con la biblioteca vacía devuelve una cola vacía", async () => {
    expect(await getDueQueue(db, { now: AHORA })).toEqual([]);
  });

  it("trae los cuatro plazos, y el de Fácil es más lejano que el de Otra vez", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await getDueQueue(db, { now: AHORA });

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

  it("adelantar reparte otro lote cuando el cupo del día ya está gastado", async () => {
    // El estado que la interfaz produce de verdad: el botón "Adelantar
    // palabras nuevas" solo se enseña cuando la cola llega vacía, y con el
    // cupo diario la cola llega vacía porque el cupo ya está gastado, no
    // porque no queden palabras. Probar `adelantar` sobre una cola que aún
    // tenía cupo (como hacía la versión anterior de esta prueba) comprueba
    // un estado en el que el botón nunca se pulsa.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 2);

    const primeras = await getDueQueue(db, { now: AHORA });
    expect(primeras).toHaveLength(2);
    await responder(primeras);

    // Cupo gastado: la pantalla vacía, que es donde vive el botón.
    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(0);

    // Adelantar concede OTRO LOTE del tamaño del tope sobre lo ya
    // introducido hoy: 2, ni 0 (el cupo gastado) ni 4 (el doble de un tope
    // que ya se gastó) ni 8 (todo lo que queda en la biblioteca).
    const adelantada = await getDueQueue(db, { now: AHORA, adelantar: true });
    expect(adelantada).toHaveLength(2);
    expect(adelantada.every((c) => c.esNueva)).toBe(true);
    // Y son palabras distintas de las ya introducidas.
    const yaVistas = primeras.map((c) => c.termId);
    expect(adelantada.some((c) => yaVistas.includes(c.termId))).toBe(false);
  });

  it("las tarjetas nuevas de hoy no se vuelven a repartir al recargar", async () => {
    // El fallo que esta prueba existe para impedir: responder el lote del día
    // saca esas tarjetas del estado "nueva", así que un tope aplicado sobre
    // "las que siguen siendo nuevas" reparte otro lote entero en cada
    // recarga, y otro, hasta agotar la biblioteca — en silencio.
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    const primeras = await getDueQueue(db, { now: AHORA });
    expect(primeras).toHaveLength(3);
    await responder(primeras);

    // Mismo instante: no ha cambiado el día, el cupo sigue gastado.
    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(0);
  });

  it("una tarjeta introducida ayer no gasta el cupo de hoy", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    const deAyer = await getDueQueue(db, { now: AYER });
    expect(deAyer).toHaveLength(3);
    await responder(deAyer, AYER);

    // Hoy vuelve a haber cupo entero: tres palabras nuevas más. (Las tres de
    // ayer vuelven además como vencidas, que es lo correcto y no cuenta.)
    const hoy = await getDueQueue(db, { now: AHORA });
    expect(hoy.filter((c) => c.esNueva)).toHaveLength(3);
  });

  it("el día empieza a medianoche en Madrid, no en UTC", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 10 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 3);

    // 23:30 UTC del día 9 es la 1:30 de la madrugada del día 10 en Madrid:
    // cuenta contra el cupo de HOY. Con el día calculado en UTC caería en
    // ayer y el cupo de hoy quedaría intacto.
    const [madrugada] = await getDueQueue(db, { now: DE_MADRUGADA });
    await responder([madrugada], DE_MADRUGADA);

    const hoy = await getDueQueue(db, { now: AHORA });
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

    const primera = await getDueQueue(db, { now: AHORA });
    expect(primera.filter((c) => !c.esNueva)).toHaveLength(3);
    expect(primera.filter((c) => c.esNueva)).toHaveLength(2);

    // Se responden solo las nuevas: el cupo del día queda gastado y las tres
    // vencidas siguen vencidas.
    await responder(primera.filter((c) => c.esNueva));

    const segunda = await getDueQueue(db, { now: AHORA });
    expect(segunda.filter((c) => c.esNueva)).toHaveLength(0);
    expect(segunda).toHaveLength(3);
  });

  it("una tarjeta ya respondida hoy no vuelve a la cola al recargar", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2)] });
    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(2);

    await applyAnswer(db, { answerId: "r1", termId: 1, rating: 3, now: AHORA });

    const cola = await getDueQueue(db, { now: AHORA });
    expect(cola.map((c) => c.termId)).toEqual([2]);
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
