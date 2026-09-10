import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay } from "@/db/repository/settings";
import { contarColecciones } from "@/db/repository/review";
import { cardStates, reviewLogs, terms } from "@/db/schema";
import { eq } from "drizzle-orm";

let db: TestDb;
let closeDb: () => Promise<void>;
const AHORA = new Date("2026-09-10T09:00:00Z");

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

/**
 * Anota una respuesta en el histórico. Es de donde sale la colección: la decide
 * el botón que pulsó el usuario, no el estado del programador. `state` es el
 * estado ANTERIOR, y va a 2 para no gastar cupo diario (solo cuentan los 0).
 */
async function anotarRespuesta(termId: number, rating: 1 | 2 | 3 | 4, cuando: Date) {
  await db.insert(reviewLogs).values({
    answerId: `prueba-${termId}-${cuando.getTime()}-${rating}`,
    termId,
    rating,
    state: 2,
    stability: 1,
    difficulty: 5,
    reviewedAt: cuando,
  });
}

/** Deja esos términos como palabras ya aprendidas ("Bien") y vencidas. */
async function madurar(termIds: number[], due = new Date("2026-09-08T09:00:00Z")) {
  for (const termId of termIds) {
    await db.update(cardStates).set({ state: 2, reps: 3, due }).where(eq(cardStates.termId, termId));
    await anotarRespuesta(termId, 3, new Date("2026-09-07T09:00:00Z"));
  }
}

/** Deja un término fallado ("Otra vez") y con la fecha que se le diga. */
async function fallada(termId: number, due: Date) {
  await db.update(cardStates).set({ state: 1, reps: 1, due }).where(eq(cardStates.termId, termId));
  await anotarRespuesta(termId, 1, new Date("2026-09-10T08:40:00Z"));
}

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

async function guardarConIds(items: ReturnType<typeof termino>[]) {
  await saveExtraction(db, { ...base, items });
  const filas = await db.select({ id: terms.id, term: terms.term }).from(terms);
  const porTermino = new Map(filas.map((f) => [f.term, f.id]));
  return { termIds: items.map((it) => porTermino.get(it.term)!) };
}

describe("contarColecciones", () => {
  it("una biblioteca vacía cuenta cero en todo", async () => {
    expect(await contarColecciones(db, AHORA)).toEqual({
      hoy: { sinAprender: 0, aprendidas: 0 },
      total: { sinAprender: 0, aprendidas: 0 },
      biblioteca: 0,
    });
  });

  it("separa lo vencido de lo adelantable en las aprendidas", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2)]);
    await madurar([termIds[0]]);
    await madurar([termIds[1]], new Date("2026-09-30T09:00:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.aprendidas).toBe(1);
    expect(resumen.total.aprendidas).toBe(2);
  });

  it("las nuevas de hoy están recortadas por el tope diario, las totales no", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2), termino(3)] });
    await setNewCardsPerDay(db, 1);

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(1);
    expect(resumen.total.sinAprender).toBe(3);
  });

  it("las que están en curso y vencidas cuentan como sin aprender", async () => {
    const { termIds } = await guardarConIds([termino(1)]);
    await fallada(termIds[0], new Date("2026-09-10T08:50:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(1);
    expect(resumen.hoy.aprendidas).toBe(0);
  });

  /**
   * Una fallada que todavía no vuelve no es trabajo de HOY, pero sí está en la
   * colección: el botón "No aprendidas" la trae si se pulsa. Antes no contaba
   * en ninguno de los dos y el botón salía en gris con un 0.
   */
  it("una en curso que aún no vence no cuenta en hoy, pero sí en total", async () => {
    const { termIds } = await guardarConIds([termino(1)]);
    await fallada(termIds[0], new Date("2026-09-11T09:00:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(0);
    expect(resumen.total.sinAprender).toBe(1);
  });

  /** El caso que motivó todo esto: responder "Bien" y ver el contador a 0. */
  it("una aprendida que aún no vence cuenta en total aunque hoy no toque", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2)]);
    await madurar(termIds, new Date("2026-09-20T09:00:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.aprendidas).toBe(0);
    expect(resumen.total.aprendidas).toBe(2);
  });
});

/**
 * `biblioteca` es el único contador que no filtra nada. Existe porque los otros
 * cuatro sí filtran a propósito, y de ellos no se puede deducir si hay
 * vocabulario: con toda la biblioteca en aprendizaje y todavía sin vencer, los
 * cuatro dan 0 y la pantalla previa decía "No tienes ninguna palabra todavía" y
 * mandaba a añadir vocabulario que ya estaba ahí.
 */
describe("contarColecciones, el recuento de la biblioteca", () => {
  it("tres palabras falladas hace un momento siguen contando en total", async () => {
    // Antes este era el agujero: los cuatro contadores daban 0 con la
    // biblioteca llena, porque nada de lo que aún no vencía se contaba. Ahora
    // `total` cuenta la colección entera y solo `hoy` mira la fecha.
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    for (const termId of termIds) await fallada(termId, new Date("2026-09-10T09:01:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy).toEqual({ sinAprender: 0, aprendidas: 0 });
    expect(resumen.total).toEqual({ sinAprender: 3, aprendidas: 0 });
    expect(resumen.biblioteca).toBe(3);
  });

  it("cuenta también lo que sí ven las dos columnas, sin duplicar", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    await madurar([termIds[0]]);
    await fallada(termIds[1], new Date("2026-09-10T08:50:00Z"));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.biblioteca).toBe(3);
  });
});
