import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { anadirDesdeDiccionario, FUENTE_DICCIONARIO } from "@/db/repository/diccionario";
import { tipoDeTermino } from "@/lib/diccionario/tipo";
import { sources, terms, termOccurrences, cardStates } from "@/db/schema";

const orilla = {
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "We sat on the bank.",
  translation: "orilla",
  level: "B1",
};

describe("tipoDeTermino", () => {
  it("una palabra suelta es 'word'", () => {
    expect(tipoDeTermino("bank", "noun")).toBe("word");
  });
  it("un verbo de varias palabras es 'phrasal_verb'", () => {
    expect(tipoDeTermino("come across", "verb")).toBe("phrasal_verb");
  });
  it("lo demás de varias palabras es 'expression'", () => {
    expect(tipoDeTermino("at the end of the day", "phrase")).toBe("expression");
  });
});

describe("anadirDesdeDiccionario", () => {
  it("crea el término, su aparición y su tarjeta de repaso", async () => {
    const { db, close } = await createTestDb();
    const { created } = await anadirDesdeDiccionario(db, orilla);

    expect(created).toBe(true);
    const [guardado] = await db.select().from(terms);
    expect(guardado.term).toBe("bank");
    expect(guardado.translation).toBe("orilla");
    expect(guardado.level).toBe("B1");
    expect(guardado.senseHint).toBe("An edge of a river.");

    expect(await db.select().from(cardStates)).toHaveLength(1);
    const [aparicion] = await db.select().from(termOccurrences);
    expect(aparicion.example).toBe("We sat on the bank.");
    await close();
  });

  it("cuelga las palabras de una única fuente 'Diccionario'", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    await anadirDesdeDiccionario(db, { ...orilla, gloss: "A financial institution.", translation: "banco" });

    const fuentes = await db.select().from(sources);
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0].title).toBe(FUENTE_DICCIONARIO);
    expect(fuentes[0].costUsd).toBe(0);
    await close();
  });

  it("guarda las dos acepciones de 'bank' como fichas distintas", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    await anadirDesdeDiccionario(db, { ...orilla, gloss: "A financial institution.", translation: "banco" });

    const guardados = await db.select().from(terms);
    expect(guardados).toHaveLength(2);
    expect(await db.select().from(cardStates)).toHaveLength(2);
    await close();
  });

  it("añadir dos veces la misma acepción no duplica", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    const segunda = await anadirDesdeDiccionario(db, orilla);

    expect(segunda.created).toBe(false);
    expect(await db.select().from(terms)).toHaveLength(1);
    await close();
  });
});
