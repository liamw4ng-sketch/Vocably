import { inArray } from "drizzle-orm";
import { dictionaryEntries, spanishMeanings, terms } from "@/db/schema";
import type { Database } from "@/db/types";
import type { Candidata } from "@/lib/extraer/candidatas";
import { tipoDeTermino } from "@/lib/diccionario/tipo";
import { MAXIMO_SIGNIFICADOS_MOSTRADOS } from "@/lib/diccionario/espanol";
import { alcanzaElSuelo, NIVELES, type Nivel } from "@/lib/nivel/mcer";
import { nivelesDe } from "@/db/repository/nivel";

export type Sugerencia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  frase: string;
  /**
   * El español **de esta acepción** (`dictionary_entries.translations`): lo que
   * traía el volcado inglés o lo que dejó escrito "Afinar con IA" en la
   * pantalla del diccionario. Es el primer escalón automático del reverso de la
   * tarjeta, por delante de `significados`, que son los de la palabra entera.
   */
  traducciones: string[];
  /**
   * El español **de la palabra** (`spanish_meanings`): definiciones enteras del
   * Wikcionario español, hasta cinco. Sirven para leerlas en pantalla; del
   * reverso de la tarjeta solo sale la primera (`lib/diccionario/traduccion.ts`).
   */
  significados: string[];
  /** `null` cuando el listado del MCER no la cubre: verbos frasales y rarezas. */
  nivel: Nivel | null;
  tipo: "word" | "phrasal_verb" | "expression";
};

/**
 * Las candidatas de un texto que merece la pena ofrecer, con todo lo que la
 * pantalla necesita para enseñarlas.
 *
 * El filtro, que es la razón de ser de esta función:
 *
 * - **Palabras sueltas y expresiones**: entran si su nivel alcanza el suelo.
 *   **Sin nivel, fuera**.
 * - **Verbos frasales**: entran **siempre**, tengan nivel o no. El listado del
 *   MCER no trae ni uno solo, así que filtrarlos por nivel los borraría todos —
 *   y son buena parte de lo que esta aplicación existe para aprender.
 *
 * Las expresiones no siempre se libraron del filtro: medido sobre un capítulo
 * real de 8.520 palabras con suelo B2, de **453 sugerencias, 243 eran
 * "expresiones"** como `not that`, `of his` o `the man` — grupos de palabras
 * que Wikcionario registra igual que un verbo frasal, pero que son ruido
 * gramatical, no vocabulario que enseñar. Más de la mitad de la lista era
 * paja, y el usuario decidió estrecharla: ahora las expresiones necesitan
 * nivel y necesitan alcanzar el suelo, igual que las palabras sueltas.
 * Consecuencia conocida y aceptada: los frasales de relleno (`take it`,
 * `do it`) sobreviven igual, porque Wikcionario los registra como verbos.
 *
 * **No se llama a MyMemory.** Traducir cientos de candidatas de golpe se comería
 * su cuota diaria de 5.000 caracteres en una sola extracción. Una candidata sin
 * español se ofrece igual; la pantalla del diccionario está para afinarla.
 */
export async function buscarSugerencias(
  db: Database,
  candidatas: Candidata[],
  suelo: Nivel,
): Promise<Sugerencia[]> {
  if (candidatas.length === 0) return [];

  const orden = new Map(candidatas.map((c, i) => [c.texto, i]));
  const frases = new Map(candidatas.map((c) => [c.texto, c.frase]));
  const textos = [...orden.keys()];

  const [acepciones, guardados, espanol, niveles] = await Promise.all([
    db
      .select({
        id: dictionaryEntries.id,
        termNormalized: dictionaryEntries.termNormalized,
        term: dictionaryEntries.term,
        pos: dictionaryEntries.pos,
        gloss: dictionaryEntries.gloss,
        example: dictionaryEntries.example,
        // El español de la acepción. Sin esto, la pantalla solo tenía los
        // significados de la palabra y acababa guardándolos encadenados como
        // reverso de la tarjeta.
        translations: dictionaryEntries.translations,
      })
      .from(dictionaryEntries)
      .where(inArray(dictionaryEntries.termNormalized, textos))
      .orderBy(dictionaryEntries.id),
    db
      .select({ termNormalized: terms.termNormalized })
      .from(terms)
      .where(inArray(terms.termNormalized, textos)),
    db
      .select({
        termNormalized: spanishMeanings.termNormalized,
        pos: spanishMeanings.pos,
        meanings: spanishMeanings.meanings,
      })
      .from(spanishMeanings)
      .where(inArray(spanishMeanings.termNormalized, textos)),
    nivelesDe(db, textos),
  ]);

  const enBiblioteca = new Set(guardados.map((g) => g.termNormalized));

  // La primera acepción de cada término: `orderBy(id)` deja delante el sentido
  // principal de Wikcionario. Ofrecer las siete de `bank` convertiría una
  // extracción de cuarenta palabras en una de trescientas.
  const primera = new Map<string, (typeof acepciones)[number]>();
  for (const a of acepciones) {
    if (!primera.has(a.termNormalized)) primera.set(a.termNormalized, a);
  }

  const significadosDe = (termNormalized: string, pos: string): string[] => {
    const suyo = espanol.find((e) => e.termNormalized === termNormalized && e.pos === pos);
    const general = espanol.find((e) => e.termNormalized === termNormalized && e.pos === "");
    return (suyo ?? general)?.meanings.slice(0, MAXIMO_SIGNIFICADOS_MOSTRADOS) ?? [];
  };

  // El puesto en el texto viaja con cada sugerencia y no se recalcula al
  // ordenar: `acepcion.term` es como lo escribe el diccionario y no tiene por
  // qué coincidir con la clave normalizada con la que se buscó.
  const conOrden: Array<{ sugerencia: Sugerencia; puesto: number }> = [];
  for (const [termNormalized, acepcion] of primera) {
    if (enBiblioteca.has(termNormalized)) continue;

    const tipo = tipoDeTermino(acepcion.term, acepcion.pos);
    const nivel = niveles.get(termNormalized) ?? null;

    // Todo menos los verbos frasales necesita nivel y necesita alcanzar el
    // suelo: palabras sueltas y expresiones por igual. Ver el comentario de
    // arriba — el porqué está medido, no supuesto.
    if (tipo !== "phrasal_verb" && (!nivel || !alcanzaElSuelo(nivel, suelo))) continue;

    conOrden.push({
      sugerencia: {
        term: acepcion.term,
        pos: acepcion.pos,
        gloss: acepcion.gloss,
        example: acepcion.example,
        frase: frases.get(termNormalized) ?? "",
        traducciones: acepcion.translations,
        significados: significadosDe(termNormalized, acepcion.pos),
        nivel,
        tipo,
      },
      puesto: orden.get(termNormalized) ?? 0,
    });
  }

  // Primero lo de **varias palabras** —frasales y expresiones—, en el orden del
  // texto; después las sueltas, de más difícil a más fácil. Es el orden que
  // pide la especificación (§8): son lo que el usuario más quiere y lo que
  // ninguna fuente gratuita sabe puntuar.
  //
  // Se agrupa por número de palabras, no por si tienen nivel: no es lo mismo.
  // Las expresiones que llegan hasta aquí siempre tienen nivel medido —desde
  // que se estrechó el filtro de arriba, lo necesitan para pasar— y aun así
  // van en el primer bloque. Lo mismo pasa con las ocho entradas verbales de
  // varias palabras que trae el listado del MCER (`mull over`, `eke out`),
  // frasales **con** nivel medido. Dentro del bloque manda el orden del texto,
  // porque el nivel que tengan unos pocos no ordenaría a los demás.
  conOrden.sort((a, b) => {
    const aEsSuelta = a.sugerencia.tipo === "word";
    const bEsSuelta = b.sugerencia.tipo === "word";
    if (aEsSuelta !== bEsSuelta) return aEsSuelta ? 1 : -1;
    if (!aEsSuelta) return a.puesto - b.puesto;
    return (
      NIVELES.indexOf(b.sugerencia.nivel as Nivel) -
      NIVELES.indexOf(a.sugerencia.nivel as Nivel)
    );
  });

  return conOrden.map((c) => c.sugerencia);
}
