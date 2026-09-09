import { and, eq, inArray } from "drizzle-orm";
import { dictionaryEntries, terms, sources, termOccurrences, cardStates } from "@/db/schema";
import type { Database } from "@/db/types";
import { filasDeLinea, type FilaDiccionario } from "@/lib/diccionario/entrada";
import { variantesDelLema } from "@/lib/diccionario/lema";
import { normalizeTerm } from "@/lib/normalize";
import { tipoDeTermino } from "@/lib/diccionario/tipo";

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
  /**
   * Cuándo toca repasarlo. La especificación (§3) pide enseñarlo junto a la
   * traducción guardada: saber que una palabra ya está no dice nada si no se
   * sabe cuándo vuelve.
   */
  due: Date;
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

/**
 * Lo que el usuario ya tiene guardado de ese término, con todas sus acepciones
 * y con la fecha del próximo repaso.
 *
 * El `innerJoin` con `card_states` es seguro: cada término gana su ficha en la
 * misma transacción que lo crea, tanto al extraer de un PDF como al añadir
 * desde el diccionario, así que un término sin ficha no existe.
 */
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
      due: cardStates.due,
    })
    .from(terms)
    .innerJoin(cardStates, eq(cardStates.termId, terms.id))
    .where(inArray(terms.termNormalized, variantesDelLema(termino)))
    .orderBy(terms.id);
}

/** Título de la fuente a la que se cuelga todo lo buscado a mano en el diccionario. */
export const FUENTE_DICCIONARIO = "Diccionario";

/** Lo que hace falta para abrir la fuente de una extracción sin IA. */
export type FuenteDeExtraccion = {
  title: string;
  pageStart: number;
  pageEnd: number;
  /** El suelo que eligió el usuario para el filtro; es el nivel de la extracción. */
  level: string;
};

/**
 * La fuente "Diccionario", creada la primera vez que hace falta. Va dentro de
 * la transacción de quien la pide, para que un término y su fuente aparezcan
 * juntos o no aparezcan.
 */
async function idDeLaFuenteDiccionario(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  level: string,
): Promise<number> {
  const existentes = await tx
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.title, FUENTE_DICCIONARIO))
    .limit(1);
  if (existentes[0]) return existentes[0].id;

  const [creada] = await tx
    .insert(sources)
    .values({ title: FUENTE_DICCIONARIO, pageStart: 0, pageEnd: 0, level })
    .returning({ id: sources.id });
  return creada.id;
}

/**
 * Abre la fuente de una extracción sin IA: **una por extracción**, con el
 * título y el rango de páginas que eligió el usuario, y coste 0.
 *
 * Sigue la forma del camino con IA (`saveExtraction`), que también crea una
 * fuente nueva por cada extracción aunque el libro se repita: para el usuario,
 * extraer dos veces el mismo libro son dos fuentes. Lo que **no** puede hacer
 * es reutilizar `FUENTE_DICCIONARIO`, que existe justamente para separar lo
 * buscado a mano de lo salido de un PDF.
 */
export async function abrirFuenteDeExtraccion(
  db: Database,
  fuente: FuenteDeExtraccion,
): Promise<number> {
  const [creada] = await db
    .insert(sources)
    .values({
      title: fuente.title.trim(),
      pageStart: fuente.pageStart,
      pageEnd: fuente.pageEnd,
      level: fuente.level,
    })
    .returning({ id: sources.id });
  return creada.id;
}

/**
 * Añade a la biblioteca una acepción encontrada en el diccionario de consulta.
 *
 * Sin `sourceId`, todo cuelga de una única fuente "Diccionario", con 0 páginas
 * y coste 0, para que la biblioteca pueda distinguir lo que se buscó a mano de
 * lo que salió de un PDF. **Con `sourceId`** —el de `abrirFuenteDeExtraccion`—
 * la palabra cuelga de la fuente de esa extracción: la extracción sin IA pasa
 * por aquí, y colgarla del "Diccionario" borraba justamente la distinción que
 * esa fuente existe para mantener.
 *
 * La clave de deduplicación es la pareja (término normalizado, pista): dos
 * acepciones distintas del mismo término ("bank" = orilla, "bank" = banco)
 * son dos fichas, no una que se pisa a la otra.
 */
export async function anadirDesdeDiccionario(
  db: Database,
  entrada: {
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translation: string;
    level: string;
    /**
     * La frase del libro en que apareció la palabra, cuando hay libro detrás.
     * Es el contexto de la tarjeta y lo que el usuario pidió expresamente:
     * "coger la palabra y el contexto en el que se ha encontrado".
     */
    context?: string;
  },
  sourceId?: number,
): Promise<{ termId: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const idDeLaFuente = sourceId ?? (await idDeLaFuenteDiccionario(tx, entrada.level));

    const clave = normalizeTerm(entrada.term);
    const yaEsta = await tx
      .select({ id: terms.id })
      .from(terms)
      .where(and(eq(terms.termNormalized, clave), eq(terms.senseHint, entrada.gloss)))
      .limit(1);

    if (yaEsta.length > 0) return { termId: yaEsta[0].id, created: false };

    const [creado] = await tx
      .insert(terms)
      .values({
        term: entrada.term.trim(),
        termNormalized: clave,
        type: tipoDeTermino(entrada.term, entrada.pos),
        translation: entrada.translation,
        level: entrada.level,
        senseHint: entrada.gloss,
      })
      .returning({ id: terms.id });

    await tx.insert(cardStates).values({ termId: creado.id });
    await tx.insert(termOccurrences).values({
      termId: creado.id,
      sourceId: idDeLaFuente,
      // La frase del libro cuando la hay —la extracción sin IA la trae, y es el
      // contexto que se enseña en el repaso—. Buscando en el diccionario no la
      // hay: no hay libro detrás, y ahí el significado en inglés es el contexto
      // más honesto. Sin este escalón, la frase se enseñaba en la pantalla de
      // extraer y se tiraba al guardar, y la tarjeta salía sin contexto porque
      // `mostrarContexto` calla lo que es igual que la pista.
      context: entrada.context?.trim() || entrada.gloss,
      example: entrada.example ?? "",
    });

    return { termId: creado.id, created: true };
  });
}

/**
 * Añade varias acepciones de una vez.
 *
 * Existe porque marcar cuarenta candidatas en una extracción no puede ser
 * cuarenta viajes al servidor. Reutiliza `anadirDesdeDiccionario` una por una,
 * pero cada llamada va dentro de su propio `try/catch`. Lo que garantiza el
 * diseño no es que el lote entero se salve o se pierda junto: es que ninguna
 * palabra arrastra a las demás, ni a las que ya se guardaron ni a las que
 * quedan por intentar. Si una entrada falla (por ejemplo, un término con un
 * carácter que Postgres rechaza en un campo de texto), su transacción se
 * deshace sola, la entrada se cuenta como fallida, y el bucle sigue con la
 * siguiente.
 *
 * Con `fuente` —lo que manda la extracción sin IA— las palabras del lote
 * cuelgan todas de **la misma fuente nueva**, abierta una sola vez antes del
 * bucle. Sin ella, cada una cuelga de "Diccionario", que es el camino de la
 * pantalla del diccionario y no cambia.
 */
export async function anadirVariasDesdeDiccionario(
  db: Database,
  entradas: Array<{
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translation: string;
    level: string;
    context?: string;
  }>,
  fuente?: FuenteDeExtraccion,
): Promise<{ creadas: number; repetidas: number; fallidas: number }> {
  let creadas = 0;
  let repetidas = 0;
  let fallidas = 0;
  // Sin nada que guardar no se abre ninguna fuente: dejaría en la biblioteca un
  // filtro por una fuente sin una sola palabra dentro.
  const sourceId =
    fuente && entradas.length > 0 ? await abrirFuenteDeExtraccion(db, fuente) : undefined;
  for (const entrada of entradas) {
    try {
      const { created } = await anadirDesdeDiccionario(db, entrada, sourceId);
      if (created) creadas += 1;
      else repetidas += 1;
    } catch {
      fallidas += 1;
    }
  }
  return { creadas, repetidas, fallidas };
}
