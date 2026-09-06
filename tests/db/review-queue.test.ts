import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay } from "@/db/repository/settings";
import { getDueQueue } from "@/db/repository/review";
import { cardStates } from "@/db/schema";
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
  });

  // La prueba de reanudación ("una tarjeta ya respondida hoy no vuelve a la
  // cola al recargar") depende de `applyAnswer`, que no existe hasta la
  // tarea 4. Se añade allí, junto con su implementación, para que este
  // archivo no quede con una prueba fallando por código que aún no existe.
});
