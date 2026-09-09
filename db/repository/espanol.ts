import { eq, sql } from "drizzle-orm";
import { spanishMeanings } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  filaDeLineaEspanola,
  MAXIMO_SIGNIFICADOS_GUARDADOS,
  type FilaEspanola,
} from "@/lib/diccionario/espanol";
import { variantesDelLema } from "@/lib/diccionario/lema";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/** El volcado del Wikcionario español: un diccionario escrito por personas. */
export const ORIGEN_WIKCIONARIO_ES = "wikcionario-es";
/** El traductor automático gratuito. */
export const ORIGEN_MYMEMORY = "mymemory";

/**
 * Dentro de un mismo lote puede haber varias filas con la misma clave
 * `(termNormalized, pos)`. No son duplicados que se puedan descartar: el
 * volcado trae una entrada por etimología, y cada etimología tiene sus
 * propios significados. Caso real del fichero: `frog` como sustantivo
 * aparece en tres entradas —"Rana. | Ranilla…", "Francés." y "Camino, calle,
 * carretera."— porque son tres etimologías distintas de esa palabra.
 * Quedarse con la última (que es lo que decía el plan original de esta
 * tarea, y era un error) dejaría `frog` = "Camino, calle, carretera." y
 * tiraría los otros dos significados a la basura; sobre el fichero real eso
 * pierde 1.062 significados.
 *
 * Por eso se fusiona: se concatenan los `meanings` de todas las filas de la
 * misma clave, en el orden en que llegaron, se quitan los repetidos exactos,
 * y se recorta a `MAXIMO_SIGNIFICADOS_GUARDADOS` **después** de fusionar (no
 * antes, o se perdería significado de las últimas etimologías sin necesidad).
 * El `term` que se guarda es el de la primera aparición.
 *
 * Hace falta además por una razón puramente técnica: dos filas con la misma
 * clave en el mismo `INSERT ... VALUES` hacen que `ON CONFLICT DO UPDATE`
 * falle con "cannot affect row a second time", y el volcado viene ordenado
 * por palabra, así que las repeticiones caen siempre en el mismo lote.
 */
function fusionarLote(lote: FilaEspanola[]): FilaEspanola[] {
  const primeraFilaPorClave = new Map<string, FilaEspanola>();
  const significadosPorClave = new Map<string, string[]>();
  const clavesEnOrden: string[] = [];

  for (const fila of lote) {
    const clave = `${fila.termNormalized} ${fila.pos}`;
    if (!primeraFilaPorClave.has(clave)) {
      primeraFilaPorClave.set(clave, fila);
      significadosPorClave.set(clave, []);
      clavesEnOrden.push(clave);
    }
    const significados = significadosPorClave.get(clave) as string[];
    for (const significado of fila.meanings) {
      if (!significados.includes(significado)) significados.push(significado);
    }
  }

  return clavesEnOrden.map((clave) => ({
    ...(primeraFilaPorClave.get(clave) as FilaEspanola),
    meanings: (significadosPorClave.get(clave) as string[]).slice(0, MAXIMO_SIGNIFICADOS_GUARDADOS),
  }));
}

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
      const filasFusionadas = fusionarLote(lote);
      await tx
        .insert(spanishMeanings)
        .values(filasFusionadas.map((fila) => ({ ...fila, source: ORIGEN_WIKCIONARIO_ES })))
        .onConflictDoUpdate({
          target: [spanishMeanings.termNormalized, spanishMeanings.pos],
          set: {
            term: sql`excluded.term`,
            meanings: sql`excluded.meanings`,
            source: sql`excluded.source`,
          },
        });
      entradas += filasFusionadas.length;
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

export type SignificadosDePalabra = {
  term: string;
  pos: string;
  meanings: string[];
  source: string;
};

/**
 * El español de una palabra. Prueba la forma escrita y luego sus variantes de
 * lema, igual que `buscarEnDiccionario`, y se para en la primera que responde.
 *
 * **Teniendo Wikcionario, se descarta lo de MyMemory**: enseñar a la vez un
 * diccionario escrito por personas y una traducción automática de la misma
 * palabra es ruido. La fila descartada no se borra — si mañana el volcado deja
 * de traer la palabra, vuelve a servir sin gastar cuota otra vez.
 */
export async function buscarSignificadosEspanoles(
  db: Database,
  termino: string,
): Promise<SignificadosDePalabra[]> {
  for (const clave of variantesDelLema(termino)) {
    const filas = await db
      .select({
        term: spanishMeanings.term,
        pos: spanishMeanings.pos,
        meanings: spanishMeanings.meanings,
        source: spanishMeanings.source,
      })
      .from(spanishMeanings)
      .where(eq(spanishMeanings.termNormalized, clave))
      .orderBy(spanishMeanings.id);

    if (filas.length === 0) continue;

    const deWikcionario = filas.filter((f) => f.source === ORIGEN_WIKCIONARIO_ES);
    return deWikcionario.length > 0 ? deWikcionario : filas;
  }
  return [];
}
