import { sql } from "drizzle-orm";
import { spanishMeanings } from "@/db/schema";
import type { Database } from "@/db/types";
import { filaDeLineaEspanola, type FilaEspanola } from "@/lib/diccionario/espanol";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/** El volcado del Wikcionario español: un diccionario escrito por personas. */
export const ORIGEN_WIKCIONARIO_ES = "wikcionario-es";
/** El traductor automático gratuito. */
export const ORIGEN_MYMEMORY = "mymemory";

/**
 * Carga el volcado español en `spanish_meanings`.
 *
 * **No vacía la tabla**, a diferencia de `cargarDiccionario`. En esta misma
 * tabla viven las filas de MyMemory, que son cuota ya gastada: borrarlas
 * obligaría a volver a pagarlas en caracteres cada vez que se recargue el
 * diccionario. Es un upsert por (término, categoría), y las de MyMemory no
 * chocan nunca porque ocupan la categoría vacía.
 */
export async function cargarEspanol(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  return db.transaction(async (tx) => {
    let entradas = 0;
    let lote: FilaEspanola[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      await tx
        .insert(spanishMeanings)
        .values(lote.map((fila) => ({ ...fila, source: ORIGEN_WIKCIONARIO_ES })))
        .onConflictDoUpdate({
          target: [spanishMeanings.termNormalized, spanishMeanings.pos],
          set: {
            term: sql`excluded.term`,
            meanings: sql`excluded.meanings`,
            source: sql`excluded.source`,
          },
        });
      entradas += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const fila = filaDeLineaEspanola(linea);
      if (!fila) continue;
      lote.push(fila);
      if (lote.length >= tamanoLote) await vaciarLote();
    }
    await vaciarLote();

    return { entradas };
  });
}
