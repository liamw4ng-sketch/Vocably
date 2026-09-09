import { eq, sql } from "drizzle-orm";
import { spanishMeanings } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  filaDeLineaEspanola,
  MAXIMO_SIGNIFICADOS_GUARDADOS,
  type FilaEspanola,
} from "@/lib/diccionario/espanol";
import { variantesDelLema } from "@/lib/diccionario/lema";
import { normalizeTerm } from "@/lib/normalize";
import type { Traductor } from "@/lib/diccionario/traductor";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/** El volcado del Wikcionario español: un diccionario escrito por personas. */
export const ORIGEN_WIKCIONARIO_ES = "wikcionario-es";
/** El traductor automático gratuito. */
export const ORIGEN_MYMEMORY = "mymemory";

/** La clave de fusión y de upsert: término normalizado + categoría. */
function claveDeFila(fila: FilaEspanola): string {
  return `${fila.termNormalized} ${fila.pos}`;
}

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
 * También evita, de paso, que dos filas con la misma clave lleguen en el
 * mismo `INSERT ... VALUES`: eso hace fallar `ON CONFLICT DO UPDATE` con
 * "cannot affect row a second time". Pero esta función **no es** lo que
 * garantiza que la fusión sea correcta entre lotes distintos — eso lo hace
 * ahora el propio `ON CONFLICT DO UPDATE` de `cargarEspanol`, fusionando en
 * SQL contra la fila que ya hubiera en la base. `fusionarLote` solo reduce
 * cuántas veces se fusiona la misma clave dentro de una carga, para ahorrar
 * trabajo; si se quitara del todo, el resultado final seguiría siendo
 * correcto, solo que con más filas fusionándose una a una en el `ON
 * CONFLICT` en vez de en memoria.
 */
function fusionarLote(lote: FilaEspanola[]): FilaEspanola[] {
  const primeraFilaPorClave = new Map<string, FilaEspanola>();
  const significadosPorClave = new Map<string, string[]>();
  const clavesEnOrden: string[] = [];

  for (const fila of lote) {
    const clave = claveDeFila(fila);
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
 * La misma clave `(termNormalized, pos)` puede aparecer en dos lotes
 * distintos y no contiguos: el volcado viene ordenado, pero eso no impide que
 * dos apariciones de la misma clave —típicamente por mayúsculas que
 * normalizan igual, p. ej. "Lord" y "lord"— queden separadas por otras
 * entradas distintas en medio. Medido sobre el fichero real: 25 significados
 * perdidos en 10 claves, todas por esta razón (`lord`/noun tenía 1 de 7,
 * `roman`/noun 1 de 5, etc.).
 *
 * `fusionarLote` no puede arreglar eso: cada llamada solo ve las filas de su
 * propio lote. Si el `ON CONFLICT` hiciera `meanings = excluded.meanings`
 * (sustituir), la segunda aparición pisaría en silencio a la primera. Así que
 * la fusión pasa a hacerse aquí, en SQL, contra la fila que ya exista en la
 * base — da igual en qué lote haya caído cada aparición.
 *
 * Esto solo se usa cuando la fila que entra ya chocó antes **dentro de esta
 * misma carga** (ver `clavesEscritasEnEstaCarga` en `cargarEspanol`): si es
 * la primera vez que esta clave aparece en la carga actual, lo que haya en la
 * base es de una carga anterior del volcado y hay que sustituirlo entero, no
 * fusionarlo — si no, una recarga nunca podría quitar un significado que
 * Wikcionario haya corregido o borrado; se acumularía para siempre.
 *
 * El procedimiento, de dentro hacia fuera:
 * 1. `unnest(... ) WITH ORDINALITY` deshace `meanings || excluded.meanings`
 *    en filas (significado, posición), conservando la posición original.
 * 2. `DISTINCT ON (significado) ... ORDER BY significado, orden` se queda con
 *    una fila por significado exacto: la de menor `orden`, es decir, la
 *    primera vez que apareció.
 * 3. `array_agg(... ORDER BY orden)` vuelve a montar el array, pero ordenado
 *    por `orden` y no por texto: así el resultado queda en el orden real de
 *    aparición, no en orden alfabético.
 * 4. `[1:MAXIMO_SIGNIFICADOS_GUARDADOS]` recorta **después** de fusionar.
 *
 * Ojo: `array_agg(DISTINCT significado)` a secas sería más corto, pero
 * Postgres ordena esa forma alfabéticamente por el propio valor — destruiría
 * el orden de los sentidos, que es justo lo que no se puede perder: los
 * primeros significados son los sentidos más comunes, y son los que se
 * enseñan primero en la aplicación.
 */
const FUSION_DE_SIGNIFICADOS = sql`(
  (
    select array_agg(fusion.significado order by fusion.orden)
    from (
      select distinct on (significado) significado, orden
      from unnest(${spanishMeanings.meanings} || excluded.meanings) with ordinality as u(significado, orden)
      order by significado, orden
    ) as fusion
  )
)[1:${MAXIMO_SIGNIFICADOS_GUARDADOS}]`;

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
    // Claves que esta misma carga ya escribió en un lote anterior. Hace falta
    // distinguirlas de las que no: si la clave es nueva en esta carga, lo que
    // haya en la base (si hay algo) es de una carga anterior del volcado —el
    // script de recarga no borra nada antes de llamar a `cargarEspanol`— y
    // toca sustituirlo entero, para que una recarga pueda seguir corrigiendo
    // o quitando significados que Wikcionario haya cambiado. Si la clave YA
    // se escribió antes en esta misma carga, lo que haya en la base es la
    // aparición anterior de la MISMA carga, y ahí sí toca fusionar.
    const clavesEscritasEnEstaCarga = new Set<string>();

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      const filasFusionadas = fusionarLote(lote);
      const filasNuevasEnEstaCarga = filasFusionadas.filter(
        (fila) => !clavesEscritasEnEstaCarga.has(claveDeFila(fila)),
      );
      const filasRepetidasEnEstaCarga = filasFusionadas.filter((fila) =>
        clavesEscritasEnEstaCarga.has(claveDeFila(fila)),
      );

      if (filasNuevasEnEstaCarga.length > 0) {
        await tx
          .insert(spanishMeanings)
          .values(filasNuevasEnEstaCarga.map((fila) => ({ ...fila, source: ORIGEN_WIKCIONARIO_ES })))
          .onConflictDoUpdate({
            target: [spanishMeanings.termNormalized, spanishMeanings.pos],
            set: {
              term: sql`excluded.term`,
              meanings: sql`excluded.meanings`,
              source: sql`excluded.source`,
            },
          });
      }

      if (filasRepetidasEnEstaCarga.length > 0) {
        await tx
          .insert(spanishMeanings)
          .values(filasRepetidasEnEstaCarga.map((fila) => ({ ...fila, source: ORIGEN_WIKCIONARIO_ES })))
          .onConflictDoUpdate({
            target: [spanishMeanings.termNormalized, spanishMeanings.pos],
            set: {
              term: sql`excluded.term`,
              meanings: FUSION_DE_SIGNIFICADOS,
              source: sql`excluded.source`,
            },
          });
      }

      for (const fila of filasFusionadas) clavesEscritasEnEstaCarga.add(claveDeFila(fila));
      entradas += filasFusionadas.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const fila = filaDeLineaEspanola(linea);
      if (!fila) continue;
      // No cortar a mitad de una clave repetida: si el lote ya llegó al
      // tamaño pero esta fila comparte clave con la última que entró, se sigue
      // acumulando. Esto ya NO es lo que garantiza la corrección — eso lo hace
      // `FUSION_DE_SIGNIFICADOS` en el `ON CONFLICT`, da igual en qué lote
      // caiga cada aparición — es solo para que `fusionarLote` pueda fundir en
      // memoria las etimologías contiguas de una clave y ahorrar así un
      // `ON CONFLICT` por cada una.
      const ultima = lote[lote.length - 1];
      if (lote.length >= tamanoLote && (!ultima || claveDeFila(fila) !== claveDeFila(ultima))) {
        await vaciarLote();
      }
      lote.push(fila);
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

/**
 * Si la palabra no tiene español, se lo pide al traductor gratuito y **lo
 * guarda**.
 *
 * Aquí está el arreglo del caché roto. Antes esto vivía en `traducirSiFalta`,
 * que escribía sobre `dictionary_entries` —una fila por acepción— y por eso
 * solo se atrevía a guardar cuando había exactamente una acepción sin español:
 * escribir "banco" en las siete entradas de *bank* habría dejado la de orilla
 * mal traducida y marcada como buena para siempre. Con varias acepciones no
 * guardaba nada, que es casi siempre, y cada búsqueda volvía a gastar cuota.
 *
 * No era un descuido: era el dato en el sitio equivocado. MyMemory contesta
 * "qué significa esta palabra", y ahora eso tiene su propia fila. Se guarda
 * siempre, sin falsear nada, y se pregunta una vez en la vida.
 *
 * La categoría queda vacía a propósito: el traductor no dice de cuál habla.
 */
export async function completarConTraductor(
  db: Database,
  termino: string,
  encontrados: SignificadosDePalabra[],
  traductor: Traductor,
): Promise<SignificadosDePalabra[]> {
  if (encontrados.length > 0) return encontrados;

  const meanings = await traductor(termino.trim());
  if (meanings.length === 0) return [];

  const term = termino.trim();
  await db
    .insert(spanishMeanings)
    .values({
      termNormalized: normalizeTerm(term),
      term,
      pos: "",
      meanings,
      source: ORIGEN_MYMEMORY,
    })
    .onConflictDoUpdate({
      target: [spanishMeanings.termNormalized, spanishMeanings.pos],
      set: { meanings: sql`excluded.meanings`, source: sql`excluded.source` },
    });

  return [{ term, pos: "", meanings, source: ORIGEN_MYMEMORY }];
}
