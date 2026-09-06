import { describe, it, expect } from "vitest";
import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { toFsrsCard, fromFsrsCard } from "@/lib/fsrs";

const fila = {
  termId: 1,
  due: new Date("2026-09-06T00:00:00Z"),
  stability: 0,
  difficulty: 0,
  elapsedDays: 0,
  scheduledDays: 0,
  reps: 0,
  lapses: 0,
  learningSteps: 0,
  state: 0,
  lastReview: null,
};

describe("puente con ts-fsrs", () => {
  it("convierte una fila en una Card con todos los campos", () => {
    const card = toFsrsCard(fila);
    const vacia = createEmptyCard(new Date("2026-09-06T00:00:00Z"));
    // `createEmptyCard` ya incluye `last_review` (con valor `undefined`) como
    // propiedad propia — no es una clave ausente en la Card real, así que no
    // se añade aquí de nuevo (ver node_modules/ts-fsrs/dist/index.umd.js:704).
    expect(Object.keys(card).sort()).toEqual(Object.keys(vacia).sort());
  });

  it("una fila nueva equivale a una tarjeta vacía", () => {
    const card = toFsrsCard(fila);
    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.due.getTime()).toBe(fila.due.getTime());
  });

  it("ida y vuelta sin perder información", () => {
    const now = new Date("2026-09-06T00:00:00Z");
    const { card } = fsrs().next(toFsrsCard(fila), now, Rating.Good);
    const vuelta = toFsrsCard({ ...fila, ...fromFsrsCard(card) });
    expect(vuelta.stability).toBeCloseTo(card.stability);
    expect(vuelta.difficulty).toBeCloseTo(card.difficulty);
    expect(vuelta.learning_steps).toBe(card.learning_steps);
    expect(vuelta.state).toBe(card.state);
    expect(vuelta.due.getTime()).toBe(card.due.getTime());
  });
});
