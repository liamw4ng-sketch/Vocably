import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarNiveles, nivelesDe } from "@/db/repository/nivel";
import { cefrLevels } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

describe("cargarNiveles", () => {
  it("guarda una fila por palabra y categoría", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("abandon,verb,B1,,,", "abandon,noun,B2,,,", "airplane/aeroplane,noun,A2,,,"),
    );

    // `entradas` son las líneas del CSV que sirvieron; `filas`, lo que queda en
    // la tabla. La de las dos grafías da una línea y dos filas.
    expect(resultado).toEqual({ entradas: 3, filas: 4 });
    expect(await db.select().from(cefrLevels)).toHaveLength(4);
    await close();
  });

  it("salta la cabecera y las líneas que no sirven", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold", "", "abandon,verb,B1,,,"),
    );

    expect(resultado).toEqual({ entradas: 1, filas: 1 });
    await close();
  });

  it("recargar no duplica: actualiza", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,"));
    await cargarNiveles(db, lineasDe("abandon,verb,B2,,,"));

    const filas = await db.select().from(cefrLevels);
    expect(filas).toHaveLength(1);
    expect(filas[0].level).toBe("B2");
    await close();
  });

  /**
   * Con lotes pequeños, dos filas de la misma clave pueden caer en el mismo
   * INSERT. Postgres rechaza tocar dos veces la misma fila en un ON CONFLICT, y
   * eso tumbaría la carga entera. Es el fallo que ya mordió en la carga del
   * diccionario español.
   */
  it("dos filas de la misma clave en el mismo lote no revientan la carga", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("study,noun,A2,,,", "study,noun,B1,,,"),
      { tamanoLote: 10 },
    );

    expect(resultado.entradas).toBe(2);
    expect(await db.select().from(cefrLevels)).toHaveLength(1);
    await close();
  });

  /**
   * Hallazgo de revisión: el número que devuelve la carga es la única
   * comprobación de una carga que se hace una sola vez, y hay que poder
   * compararlo con el fichero fuente y con la tabla. Contando las filas antes
   * de deduplicar no cuadraba con ninguno de los dos. Ahora dice las dos cosas:
   * las líneas del CSV que sirvieron y las filas que quedan escritas.
   */
  it("dice las líneas leídas y las filas escritas, que no son el mismo número", async () => {
    const { db, close } = await createTestDb();

    const resultado = await cargarNiveles(
      db,
      lineasDe("study,noun,A2,,,", "study,noun,B1,,,"),
      { tamanoLote: 10 },
    );

    expect(resultado).toEqual({ entradas: 2, filas: 1 });
    expect(resultado.filas).toBe((await db.select().from(cefrLevels)).length);
    await close();
  });

  it("escribe por lotes sin perder ninguna entrada", async () => {
    const { db, close } = await createTestDb();
    const muchas = Array.from({ length: 7 }, (_, i) => `palabra${i},noun,B1,,,`);

    const resultado = await cargarNiveles(db, lineasDe(...muchas), { tamanoLote: 2 });

    expect(resultado).toEqual({ entradas: 7, filas: 7 });
    expect(await db.select().from(cefrLevels)).toHaveLength(7);
    await close();
  });
});

describe("nivelesDe", () => {
  it("devuelve el nivel de cada término pedido", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,", "house,noun,A1,,,"));

    const niveles = await nivelesDe(db, ["abandon", "house"]);

    expect(niveles.get("abandon")).toBe("B1");
    expect(niveles.get("house")).toBe("A1");
    await close();
  });

  /**
   * `study` es A1 como verbo y A2 como sustantivo. El nivel de la palabra es
   * aquel en el que el estudiante se la encuentra primero: el más bajo.
   */
  it("con varias categorías se queda con el nivel más bajo", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("study,noun,A2,,,", "study,verb,A1,,,"));

    expect((await nivelesDe(db, ["study"])).get("study")).toBe("A1");
    await close();
  });

  it("lo que no está no aparece en el mapa", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,"));

    const niveles = await nivelesDe(db, ["abandon", "xyzzy"]);

    expect(niveles.has("xyzzy")).toBe(false);
    expect(niveles.size).toBe(1);
    await close();
  });

  it("con la lista vacía no consulta y devuelve un mapa vacío", async () => {
    const { db, close } = await createTestDb();
    expect((await nivelesDe(db, [])).size).toBe(0);
    await close();
  });
});
