import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cefrLevels } from "@/db/schema";

describe("cefr_levels", () => {
  it("guarda una palabra con su categoría y su nivel", async () => {
    const { db, close } = await createTestDb();
    await db.insert(cefrLevels).values({
      termNormalized: "abandon",
      term: "abandon",
      pos: "verb",
      level: "B1",
    });

    const [fila] = await db.select().from(cefrLevels);
    expect(fila.term).toBe("abandon");
    expect(fila.level).toBe("B1");
    await close();
  });

  /**
   * El listado puede dar a la misma palabra un nivel como sustantivo y otro
   * como verbo. Son dos filas.
   */
  it("deja la misma palabra en dos categorías", async () => {
    const { db, close } = await createTestDb();
    await db.insert(cefrLevels).values([
      { termNormalized: "study", term: "study", pos: "noun", level: "A2" },
      { termNormalized: "study", term: "study", pos: "verb", level: "A1" },
    ]);

    expect(await db.select().from(cefrLevels)).toHaveLength(2);
    await close();
  });

  /** El único es lo que hace que recargar el listado actualice en vez de duplicar. */
  it("rechaza la misma palabra y categoría dos veces", async () => {
    const { db, close } = await createTestDb();
    const fila = { termNormalized: "study", term: "study", pos: "noun", level: "A2" };
    await db.insert(cefrLevels).values(fila);

    await expect(db.insert(cefrLevels).values(fila)).rejects.toThrow();
    await close();
  });
});
