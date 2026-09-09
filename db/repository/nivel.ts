import { inArray, sql } from "drizzle-orm";
import { cefrLevels } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  filasDeLineaMcer,
  NIVELES,
  type FilaNivel,
  type Nivel,
} from "@/lib/nivel/mcer";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/**
 * Carga el listado del MCER en `cefr_levels`.
 *
 * Sustituye al chocar, no fusiona: aquí no conviven dos orígenes en la misma
 * tabla, a diferencia de `spanish_meanings`.
 *
 * **Deduplica cada lote antes de escribirlo.** Postgres rechaza un
 * `ON CONFLICT DO UPDATE` que toque dos veces la misma fila en el mismo INSERT,
 * y eso tumbaría la carga entera. El listado trae la misma clave repetida
 * cuando dos grafías de una entrada normalizan igual.
 */
export async function cargarNiveles(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  return db.transaction(async (tx) => {
    let entradas = 0;
    let lote: FilaNivel[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      const porClave = new Map<string, FilaNivel>();
      for (const fila of lote) porClave.set(`${fila.termNormalized}\t${fila.pos}`, fila);

      await tx
        .insert(cefrLevels)
        .values([...porClave.values()])
        .onConflictDoUpdate({
          target: [cefrLevels.termNormalized, cefrLevels.pos],
          set: { term: sql`excluded.term`, level: sql`excluded.level` },
        });
      entradas += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const filas = filasDeLineaMcer(linea);
      if (filas.length === 0) continue;
      lote.push(...filas);
      if (lote.length >= tamanoLote) await vaciarLote();
    }
    await vaciarLote();

    return { entradas };
  });
}

/**
 * El nivel de cada término pedido.
 *
 * Cuando una palabra aparece con varias categorías —`study` es A1 como verbo y
 * A2 como sustantivo— se queda **el más bajo**: es el nivel al que el estudiante
 * se topa con esa palabra por primera vez, y por tanto el que decide si ya
 * debería saberla.
 */
export async function nivelesDe(
  db: Database,
  terminos: string[],
): Promise<Map<string, Nivel>> {
  if (terminos.length === 0) return new Map();

  const filas = await db
    .select({ termNormalized: cefrLevels.termNormalized, level: cefrLevels.level })
    .from(cefrLevels)
    .where(inArray(cefrLevels.termNormalized, terminos));

  const niveles = new Map<string, Nivel>();
  for (const fila of filas) {
    const nivel = fila.level as Nivel;
    const previo = niveles.get(fila.termNormalized);
    if (!previo || NIVELES.indexOf(nivel) < NIVELES.indexOf(previo)) {
      niveles.set(fila.termNormalized, nivel);
    }
  }
  return niveles;
}
