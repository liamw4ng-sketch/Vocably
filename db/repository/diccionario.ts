import { eq, inArray } from "drizzle-orm";
import { dictionaryEntries, terms } from "@/db/schema";
import type { Database } from "@/db/types";
import { filasDeLinea, type FilaDiccionario } from "@/lib/diccionario/entrada";
import { variantesDelLema } from "@/lib/diccionario/lema";

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

export type AcepcionDiccionario = {
  id: number;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
};

export type TerminoGuardado = {
  id: number;
  term: string;
  translation: string;
  level: string;
  senseHint: string;
};

/**
 * Busca la forma escrita y, si no da nada, sus variantes de lema. Se prueban en
 * orden y se para en la primera que responde: mezclar los resultados de dos
 * lemas distintos enseñaría dos fichas casi iguales sin decir por qué.
 */
export async function buscarEnDiccionario(
  db: Database,
  termino: string,
): Promise<AcepcionDiccionario[]> {
  for (const clave of variantesDelLema(termino)) {
    const filas = await db
      .select({
        id: dictionaryEntries.id,
        term: dictionaryEntries.term,
        pos: dictionaryEntries.pos,
        gloss: dictionaryEntries.gloss,
        example: dictionaryEntries.example,
        translations: dictionaryEntries.translations,
      })
      .from(dictionaryEntries)
      .where(eq(dictionaryEntries.termNormalized, clave))
      .orderBy(dictionaryEntries.id);
    if (filas.length > 0) return filas;
  }
  return [];
}

/** Lo que el usuario ya tiene guardado de ese término, con todas sus acepciones. */
export async function buscarEnBiblioteca(
  db: Database,
  termino: string,
): Promise<TerminoGuardado[]> {
  return db
    .select({
      id: terms.id,
      term: terms.term,
      translation: terms.translation,
      level: terms.level,
      senseHint: terms.senseHint,
    })
    .from(terms)
    .where(inArray(terms.termNormalized, variantesDelLema(termino)))
    .orderBy(terms.id);
}
