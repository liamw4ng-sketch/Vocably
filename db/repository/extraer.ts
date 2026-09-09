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
 * - **Palabras sueltas**: entran si su nivel alcanza el suelo. **Sin nivel,
 *   fuera**: son nombres propios y rarezas que el listado no cubre.
 * - **Verbos frasales y expresiones**: entran **siempre**. El listado del MCER
 *   no trae ni uno solo, así que filtrarlos por nivel los borraría todos — y
 *   son buena parte de lo que esta aplicación existe para aprender.
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

    // Las de una sola palabra necesitan nivel y necesitan alcanzar el suelo.
    // Las de varias entran siempre: ver el comentario de arriba.
    if (tipo === "word" && (!nivel || !alcanzaElSuelo(nivel, suelo))) continue;

    conOrden.push({
      sugerencia: {
        term: acepcion.term,
        pos: acepcion.pos,
        gloss: acepcion.gloss,
        example: acepcion.example,
        frase: frases.get(termNormalized) ?? "",
        significados: significadosDe(termNormalized, acepcion.pos),
        nivel,
        tipo,
      },
      puesto: orden.get(termNormalized) ?? 0,
    });
  }

  // Primero lo que no tiene nivel medido —los frasales y las expresiones—, en el
  // orden del texto; después las sueltas, de más difícil a más fácil.
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
