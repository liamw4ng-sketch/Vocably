import { dictionaryEntries } from "@/db/schema";
import type { Database } from "@/db/types";
import { filasDeLinea, type FilaDiccionario } from "@/lib/diccionario/entrada";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/**
 * Vacía la tabla y la vuelve a llenar. Es a propósito: el diccionario es
 * material de consulta, no datos del usuario, así que recargarlo entero es más
 * simple y más seguro que intentar fusionar 181.103 filas.
 */
export async function cargarDiccionario(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number; filas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  return db.transaction(async (tx) => {
    await tx.delete(dictionaryEntries);

    let entradas = 0;
    let filas = 0;
    let lote: FilaDiccionario[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      await tx.insert(dictionaryEntries).values(lote);
      filas += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const nuevas = filasDeLinea(linea);
      if (nuevas.length === 0) continue;
      entradas += 1;
      lote.push(...nuevas);
      if (lote.length >= tamanoLote) await vaciarLote();
    }
    await vaciarLote();

    return { entradas, filas };
  });
}
