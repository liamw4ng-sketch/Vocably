import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { applyAnswer } from "@/db/repository/review";
import { cardStates, reviewLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Rating, State } from "ts-fsrs";

let db: TestDb;
let closeDb: () => Promise<void>;
const AHORA = new Date("2026-09-10T09:00:00Z");

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
  await saveExtraction(db, {
    title: "Libro",
    pageStart: 1,
    pageEnd: 5,
    level: "B2",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    items: [
      {
        term: "come across",
        type: "phrasal_verb",
        translation: "encontrarse con",
        context: "I came across a photo.",
        example: "She came across an article.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

async function ficha() {
  const [f] = await db.select().from(cardStates).where(eq(cardStates.termId, 1));
  return f;
}

describe("applyAnswer", () => {
  it("adelanta la tarjeta y registra el repaso", async () => {
    const antes = await ficha();
    expect(antes.state).toBe(State.New);

    const r = await applyAnswer(db, {
      answerId: "a1",
      termId: 1,
      rating: Rating.Good,
      now: AHORA,
    });

    expect(r.aplicada).toBe(true);
    const despues = await ficha();
    expect(despues.reps).toBe(1);
    expect(despues.state).not.toBe(State.New);
    expect(despues.due.getTime()).toBeGreaterThan(AHORA.getTime());
    expect(despues.lastReview?.getTime()).toBe(AHORA.getTime());
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("IGNORA una respuesta repetida con el mismo identificador", async () => {
    await applyAnswer(db, { answerId: "a1", termId: 1, rating: Rating.Good, now: AHORA });
    const tras_una = await ficha();

    const r = await applyAnswer(db, {
      answerId: "a1",
      termId: 1,
      rating: Rating.Good,
      now: new Date("2026-09-10T09:05:00Z"),
    });

    expect(r.aplicada).toBe(false);
    const tras_dos = await ficha();
    expect(tras_dos.reps).toBe(tras_una.reps);
    expect(tras_dos.due.getTime()).toBe(tras_una.due.getTime());
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("dos respuestas distintas sí se aplican las dos", async () => {
    await applyAnswer(db, { answerId: "a1", termId: 1, rating: Rating.Good, now: AHORA });
    await applyAnswer(db, {
      answerId: "a2",
      termId: 1,
      rating: Rating.Good,
      now: new Date("2026-09-10T09:20:00Z"),
    });
    expect((await ficha()).reps).toBe(2);
    expect(await db.select().from(reviewLogs)).toHaveLength(2);
  });

  it("«Otra vez» acorta el plazo frente a «Fácil»", async () => {
    // Sobre la MISMA tarjeta de partida, en dos bases idénticas, para que la
    // única diferencia sea el botón pulsado.
    const otra = await applyAnswer(db, {
      answerId: "x",
      termId: 1,
      rating: Rating.Again,
      now: AHORA,
    });

    const t2 = await createTestDb();
    await saveExtraction(t2.db, {
      title: "Libro",
      pageStart: 1,
      pageEnd: 5,
      level: "B2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: [
        {
          term: "come across",
          type: "phrasal_verb",
          translation: "encontrarse con",
          context: "I came across a photo.",
          example: "She came across an article.",
        },
      ],
    });
    const facil = await applyAnswer(t2.db, {
      answerId: "y",
      termId: 1,
      rating: Rating.Easy,
      now: AHORA,
    });
    await t2.close();

    expect(otra.proximaFecha.getTime()).toBeLessThan(facil.proximaFecha.getTime());
  });

  it("falla si el término no existe", async () => {
    await expect(
      applyAnswer(db, { answerId: "z", termId: 999, rating: Rating.Good, now: AHORA }),
    ).rejects.toThrow();
  });
});
