import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarSugerencias } from "@/db/repository/extraer";
import { cargarNiveles } from "@/db/repository/nivel";
import { anadirDesdeDiccionario } from "@/db/repository/diccionario";
import { dictionaryEntries, spanishMeanings } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

/** Deja una base con tres palabras: dos sueltas de distinto nivel y un frasal. */
async function baseConDiccionario(db: Parameters<typeof buscarSugerencias>[0]) {
  await db.insert(dictionaryEntries).values([
    { termNormalized: "abandon", term: "abandon", pos: "verb", gloss: "To leave behind.", example: null },
    { termNormalized: "house", term: "house", pos: "noun", gloss: "A building.", example: null },
    { termNormalized: "give up", term: "give up", pos: "verb", gloss: "To stop trying.", example: null },
  ]);
  await cargarNiveles(db, lineasDe("abandon,verb,B2,,,", "house,noun,A1,,,"));
}

const candidata = (texto: string) => ({ texto, frase: `Frase con ${texto}.` });

describe("buscarSugerencias", () => {
  it("deja pasar una palabra que alcanza el suelo", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s).toHaveLength(1);
    expect(s[0].term).toBe("abandon");
    expect(s[0].nivel).toBe("B2");
    expect(s[0].tipo).toBe("word");
    expect(s[0].frase).toBe("Frase con abandon.");
    await close();
  });

  it("corta una palabra por debajo del suelo", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    expect(await buscarSugerencias(db, [candidata("house")], "B2")).toEqual([]);
    await close();
  });

  /**
   * Es la razón de ser de la decisión 2 del usuario: el listado del MCER no
   * trae ni un verbo frasal, así que filtrar solo por nivel los borraría todos.
   */
  it("deja pasar un verbo frasal aunque no tenga nivel", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("give up")], "C2");

    expect(s).toHaveLength(1);
    expect(s[0].term).toBe("give up");
    expect(s[0].nivel).toBeNull();
    expect(s[0].tipo).toBe("phrasal_verb");
    await close();
  });

  it("corta una palabra suelta sin nivel: es nombre propio o rareza", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(dictionaryEntries).values({
      termNormalized: "sherlock", term: "Sherlock", pos: "noun", gloss: "A detective.", example: null,
    });

    expect(await buscarSugerencias(db, [candidata("sherlock")], "A1")).toEqual([]);
    await close();
  });

  it("lo que no está en el diccionario no llega a la lista", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    expect(await buscarSugerencias(db, [candidata("xyzzy")], "A1")).toEqual([]);
    await close();
  });

  it("lo que ya está en la biblioteca no se vuelve a ofrecer", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await anadirDesdeDiccionario(db, {
      term: "abandon", pos: "verb", gloss: "To leave behind.",
      example: null, translation: "abandonar", level: "B2",
    });

    expect(await buscarSugerencias(db, [candidata("abandon")], "B2")).toEqual([]);
    await close();
  });

  it("trae los significados en español de la palabra", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(spanishMeanings).values({
      termNormalized: "abandon", term: "abandon", pos: "verb",
      meanings: ["Abandonar.", "Dejar."], source: "wikcionario-es",
    });

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s[0].significados).toEqual(["Abandonar.", "Dejar."]);
    await close();
  });

  it("una palabra sin español se ofrece igual, con la lista vacía", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s).toHaveLength(1);
    expect(s[0].significados).toEqual([]);
    await close();
  });

  /**
   * `bank` tiene siete acepciones. Ofrecer las siete convertiría una extracción
   * de cuarenta palabras en una de trescientas.
   */
  it("de una palabra con varias acepciones ofrece una sola, la primera", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("bank,noun,B1,,,"));
    await db.insert(dictionaryEntries).values([
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", example: null },
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", example: null },
    ]);

    const s = await buscarSugerencias(db, [candidata("bank")], "B1");

    expect(s).toHaveLength(1);
    expect(s[0].gloss).toBe("A financial institution.");
    await close();
  });

  it("ordena los frasales primero y las sueltas de más difícil a más fácil", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(dictionaryEntries).values({
      termNormalized: "ubiquitous", term: "ubiquitous", pos: "adj", gloss: "Everywhere.", example: null,
    });
    await cargarNiveles(db, lineasDe("ubiquitous,adjective,C2,,,"));

    const s = await buscarSugerencias(
      db,
      [candidata("abandon"), candidata("ubiquitous"), candidata("give up")],
      "B1",
    );

    expect(s.map((x) => x.term)).toEqual(["give up", "ubiquitous", "abandon"]);
    await close();
  });

  it("con la lista de candidatas vacía devuelve lista vacía", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarSugerencias(db, [], "B1")).toEqual([]);
    await close();
  });
});
