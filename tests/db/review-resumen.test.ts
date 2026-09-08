import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay } from "@/db/repository/settings";
import { contarColecciones } from "@/db/repository/review";
import { cardStates, terms } from "@/db/schema";
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

/** Deja esos términos como palabras ya aprendidas y vencidas desde hace días. */
async function madurar(termIds: number[], due = new Date("2026-09-08T09:00:00Z")) {
  for (const termId of termIds) {
    await db.update(cardStates).set({ state: 2, reps: 3, due }).where(eq(cardStates.termId, termId));
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
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-09-30T09:00:00Z") })
      .where(eq(cardStates.termId, termIds[1]));

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
    await db
      .update(cardStates)
      .set({ state: 1, reps: 1, due: new Date("2026-09-10T08:50:00Z") })
      .where(eq(cardStates.termId, termIds[0]));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(1);
    expect(resumen.hoy.aprendidas).toBe(0);
  });

  it("una en curso que aún no vence no cuenta ni en hoy ni en total: getDueQueue la descarta entera", async () => {
    // getDueQueue solo mete en la sesión las Learning/Relearning que YA
    // vencen; las que no, se tiran sin entrar en ningún grupo (a diferencia
    // de las aprendidas futuras, que sí se recogen para poder adelantarlas).
    // Si `total.sinAprender` las contara, la pantalla previa ofrecería
    // "no aprendidas" como modo con tarjetas, y la sesión volvería vacía.
    const { termIds } = await guardarConIds([termino(1)]);
    await db
      .update(cardStates)
      .set({ state: 1, reps: 1, due: new Date("2026-09-11T09:00:00Z") })
      .where(eq(cardStates.termId, termIds[0]));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(0);
    expect(resumen.total.sinAprender).toBe(0);
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
  it("cuenta las tarjetas que ninguna de las dos columnas ve", async () => {
    // La reproducción: tres palabras respondidas "Otra vez" hace un momento.
    // Quedan en aprendizaje y sin vencer todavía.
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    for (const termId of termIds) {
      await db
        .update(cardStates)
        .set({ state: 1, reps: 1, due: new Date("2026-09-10T09:01:00Z") })
        .where(eq(cardStates.termId, termId));
    }

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.total).toEqual({ sinAprender: 0, aprendidas: 0 });
    expect(resumen.biblioteca).toBe(3);
  });

  it("cuenta también lo que sí ven las dos columnas, sin duplicar", async () => {
    const { termIds } = await guardarConIds([termino(1), termino(2), termino(3)]);
    await madurar([termIds[0]]);
    await db
      .update(cardStates)
      .set({ state: 1, reps: 1, due: new Date("2026-09-10T08:50:00Z") })
      .where(eq(cardStates.termId, termIds[1]));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.biblioteca).toBe(3);
  });
});
