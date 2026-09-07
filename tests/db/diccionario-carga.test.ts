import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarDiccionario } from "@/db/repository/diccionario";
import { dictionaryEntries } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

const bank = JSON.stringify({
  w: "bank",
  p: "noun",
  s: [{ g: "A financial institution." }, { g: "An edge of a river." }],
});
const basura = JSON.stringify({
  w: "look at",
  p: "verb",
  s: [{ g: "Used other than figuratively or idiomatically: see look, at." }],
});

describe("cargarDiccionario", () => {
  it("guarda una fila por acepción y cuenta lo cargado", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarDiccionario(db, lineasDe(bank));

    expect(resultado).toEqual({ entradas: 1, filas: 2 });
    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("salta las entradas sin ninguna acepción útil", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarDiccionario(db, lineasDe(bank, basura, ""));

    expect(resultado.entradas).toBe(1);
    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("vacía antes de cargar: recargar no duplica", async () => {
    const { db, close } = await createTestDb();
    await cargarDiccionario(db, lineasDe(bank));
    await cargarDiccionario(db, lineasDe(bank));

    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("respeta el tamaño de lote sin perder filas", async () => {
    const { db, close } = await createTestDb();
    await cargarDiccionario(db, lineasDe(bank, bank, bank), { tamanoLote: 2 });

    expect(await db.select().from(dictionaryEntries)).toHaveLength(6);
    await close();
  });

  it("si falla a mitad de carga, la tabla se queda como estaba (transacción atómica)", async () => {
    const { db, close } = await createTestDb();

    // Cargar primero un diccionario conocido
    await cargarDiccionario(db, lineasDe(bank));
    const conteoAntes = (await db.select().from(dictionaryEntries)).length;
    expect(conteoAntes).toBe(2);

    // Iterable que falla a mitad
    async function* lineasQueFallan() {
      yield bank; // una línea buena
      throw new Error("Simulated network timeout after partial insert");
    }

    // Intentar cargar: debe fallar
    await expect(cargarDiccionario(db, lineasQueFallan())).rejects.toThrow(
      "Simulated network timeout after partial insert"
    );

    // Verificar que la tabla sigue con el contenido anterior, no vacía
    const conteoDesp = (await db.select().from(dictionaryEntries)).length;
    expect(conteoDesp).toBe(conteoAntes);

    await close();
  });
});
