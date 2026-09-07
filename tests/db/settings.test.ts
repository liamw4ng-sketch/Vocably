import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import {
  getNewCardsPerDay,
  setNewCardsPerDay,
  getReviewsPerSession,
  setReviewsPerSession,
  getAjustes,
} from "@/db/repository/settings";

let db: TestDb;
let closeDb: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

describe("ajustes", () => {
  it("sin fila guardada devuelve 20 por defecto", async () => {
    expect(await getNewCardsPerDay(db)).toBe(20);
  });

  it("guarda y recupera un valor nuevo", async () => {
    await setNewCardsPerDay(db, 5);
    expect(await getNewCardsPerDay(db)).toBe(5);
  });

  it("guardar dos veces no crea dos filas", async () => {
    await setNewCardsPerDay(db, 5);
    await setNewCardsPerDay(db, 30);
    expect(await getNewCardsPerDay(db)).toBe(30);
  });

  it("rechaza un tope negativo o no entero", async () => {
    await expect(setNewCardsPerDay(db, -1)).rejects.toThrow();
    await expect(setNewCardsPerDay(db, 2.5)).rejects.toThrow();
  });

  it("sin fila guardada los repasos por sesión son 0, es decir, sin límite", async () => {
    expect(await getReviewsPerSession(db)).toBe(0);
  });

  it("guarda y recupera los repasos por sesión", async () => {
    await setReviewsPerSession(db, 15);
    expect(await getReviewsPerSession(db)).toBe(15);
  });

  it("los dos ajustes viven en la misma fila y no se pisan", async () => {
    await setNewCardsPerDay(db, 7);
    await setReviewsPerSession(db, 15);
    expect(await getAjustes(db)).toEqual({ newCardsPerDay: 7, reviewsPerSession: 15 });

    await setNewCardsPerDay(db, 8);
    expect(await getAjustes(db)).toEqual({ newCardsPerDay: 8, reviewsPerSession: 15 });
  });

  it("rechaza unos repasos por sesión negativos o no enteros", async () => {
    await expect(setReviewsPerSession(db, -1)).rejects.toThrow();
    await expect(setReviewsPerSession(db, 2.5)).rejects.toThrow();
  });
});