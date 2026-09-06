import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { sources, terms } from "@/db/schema";

describe("esquema", () => {
  it("guarda y recupera una fuente", async () => {
    const { db, close } = await createTestDb();
    await db.insert(sources).values({
      title: "Cambridge B2 First",
      pageStart: 12,
      pageEnd: 18,
      level: "B2",
    });
    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Cambridge B2 First");
    expect(rows[0].costUsd).toBe(0);
    await close();
  });

  it("rechaza dos términos con la misma forma normalizada", async () => {
    const { db, close } = await createTestDb();
    const row = {
      term: "come across",
      termNormalized: "come across",
      type: "phrasal_verb",
      translation: "encontrarse con",
      level: "B2",
    };
    await db.insert(terms).values(row);
    await expect(db.insert(terms).values(row)).rejects.toThrow();
    await close();
  });
});
