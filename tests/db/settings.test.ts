import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import {
  getNewCardsPerDay,
  setNewCardsPerDay,
  setSessionSize,
  setSessionMode,
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
  /** El tope viene apagado: 0 significa "sin tope", como el 0 del tamaño de sesión. */
  it("sin fila guardada no hay tope de nuevas", async () => {
    expect(await getNewCardsPerDay(db)).toBe(0);
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

  it("el tamaño de sesión por defecto es 0: la app no recorta por su cuenta", async () => {
    expect((await getAjustes(db)).sessionSize).toBe(0);
  });

  it("el modo por defecto es mezcla", async () => {
    expect((await getAjustes(db)).sessionMode).toBe("mezcla");
  });

  it("guarda el tamaño de sesión", async () => {
    await setSessionSize(db, 15);
    expect((await getAjustes(db)).sessionSize).toBe(15);
  });

  it("guarda el modo", async () => {
    await setSessionMode(db, "aprendidas");
    expect((await getAjustes(db)).sessionMode).toBe("aprendidas");
  });

  it("guardar un ajuste no pisa el otro", async () => {
    await setNewCardsPerDay(db, 7);
    await setSessionSize(db, 15);
    await setSessionMode(db, "no-aprendidas");

    const ajustes = await getAjustes(db);
    expect(ajustes.newCardsPerDay).toBe(7);
    expect(ajustes.sessionSize).toBe(15);
    expect(ajustes.sessionMode).toBe("no-aprendidas");
  });

  it("rechaza un tamaño de sesión negativo", async () => {
    await expect(setSessionSize(db, -1)).rejects.toThrow();
  });

  it("rechaza un tamaño de sesión no entero", async () => {
    await expect(setSessionSize(db, 2.5)).rejects.toThrow();
  });

  it("rechaza un modo que no existe", async () => {
    await expect(setSessionMode(db, "inventado" as never)).rejects.toThrow();
  });
});
