import { and, eq, inArray } from "drizzle-orm";
import { dictionaryEntries, terms, sources, termOccurrences, cardStates } from "@/db/schema";
import type { Database } from "@/db/types";
import { filasDeLinea, type FilaDiccionario } from "@/lib/diccionario/entrada";
import { variantesDelLema } from "@/lib/diccionario/lema";
import { normalizeTerm } from "@/lib/normalize";
import { tipoDeTermino } from "@/lib/diccionario/tipo";
import type { Traductor } from "@/lib/diccionario/traductor";

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
 * Rellena el español que falte y, cuando el dato es de verdad de esa acepción,
 * lo guarda. Todas las acepciones vienen de una misma búsqueda, así que
 * comparten término: se llama al traductor **una sola vez**.
 *
 * **Solo se cachea si hay exactamente una acepción sin español.** No es un
 * olvido, es la parte importante: el traductor recibe el término suelto —así
 * lo pide la especificación §8, porque mandarlo pegado a su definición rompe
 * la traducción— y su respuesta es la del término, no la de una acepción
 * concreta. Con varias acepciones sin español, escribir "banco" en las siete
 * entradas de *bank* dejaría la de orilla mal traducida y marcada como
 * cacheada, y una fila cacheada no se reintenta nunca: la única salida sería
 * el botón que cuesta dinero. Con una sola acepción no hay ambigüedad posible,
 * y ahí sí se guarda para no volver a preguntar. Mostrarlo sin guardarlo no
 * cuesta nada: MyMemory es gratis y se le puede volver a preguntar mañana.
 */
export async function traducirSiFalta(
  db: Database,
  acepciones: AcepcionDiccionario[],
  traductor: Traductor,
): Promise<AcepcionDiccionario[]> {
  const sinEspanol = acepciones.filter((a) => a.translations.length === 0);
  if (sinEspanol.length === 0) return acepciones;

  const traducciones = await traductor(sinEspanol[0].term);
  if (traducciones.length === 0) return acepciones;

  if (sinEspanol.length === 1) {
    // Una sola escritura, no una por acepción.
    await db
      .update(dictionaryEntries)
      .set({ translations: traducciones, translationSource: "mymemory" })
      .where(eq(dictionaryEntries.id, sinEspanol[0].id));
  }

  return acepciones.map((a) =>
    a.translations.length === 0 ? { ...a, translations: traducciones } : a,
  );
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

/**
 * Añade a la biblioteca una acepción encontrada en el diccionario de consulta.
 * Todo lo buscado a mano cuelga de una única fuente "Diccionario", con 0
 * páginas y coste 0, para que la biblioteca pueda distinguir lo que se buscó
 * de lo que salió de un PDF.
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
  },
): Promise<{ termId: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const existentes = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.title, FUENTE_DICCIONARIO))
      .limit(1);

    const sourceId =
      existentes[0]?.id ??
      (
        await tx
          .insert(sources)
          .values({
            title: FUENTE_DICCIONARIO,
            pageStart: 0,
            pageEnd: 0,
            level: entrada.level,
          })
          .returning({ id: sources.id })
      )[0].id;

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
      sourceId,
      // El diccionario no da la frase en que se encontró la palabra: no hay
      // libro detrás. El significado en inglés es el contexto más honesto.
      context: entrada.gloss,
      example: entrada.example ?? "",
    });

    return { termId: creado.id, created: true };
  });
}
