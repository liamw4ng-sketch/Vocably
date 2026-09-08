/**
 * Las categorías gramaticales tal como las nombra Wikcionario, con su nombre en
 * español y en el orden en que se enseñan.
 *
 * El orden es fijo y a propósito: ni por frecuencia ni por identificador. Una
 * palabra como `bank` tiene siete fichas repartidas en varias categorías, y que
 * salgan siempre en la misma posición es lo que permite reconocer la que se
 * busca de un vistazo. Delante van las cuatro categorías que un estudiante mira
 * el 95 % de las veces.
 */
const CATEGORIAS: ReadonlyArray<readonly [string, string]> = [
  ["noun", "Sustantivo"],
  ["verb", "Verbo"],
  ["adj", "Adjetivo"],
  ["adv", "Adverbio"],
  ["phrase", "Expresión"],
  ["prep_phrase", "Locución preposicional"],
  ["proverb", "Refrán"],
  ["intj", "Interjección"],
  ["prep", "Preposición"],
  ["pron", "Pronombre"],
  ["det", "Determinante"],
  ["num", "Numeral"],
  ["conj", "Conjunción"],
  ["particle", "Partícula"],
  ["contraction", "Contracción"],
];

const NOMBRES = new Map(CATEGORIAS);
const ORDEN = new Map(CATEGORIAS.map(([pos], i) => [pos, i]));

/**
 * Una categoría que no esté en la lista se muestra tal cual viene. El volcado de
 * Wikcionario puede traer alguna rara que el filtro haya dejado pasar, y enseñar
 * `circumfix` es mejor que enseñar un hueco o reventar.
 */
export function nombreDeCategoria(pos: string): string {
  return NOMBRES.get(pos) ?? pos;
}

export type GrupoDeAcepciones<T> = {
  pos: string;
  nombre: string;
  acepciones: T[];
};

/** Agrupa las acepciones por categoría, en el orden de `CATEGORIAS`. */
export function agruparPorCategoria<T extends { pos: string }>(
  acepciones: readonly T[],
): GrupoDeAcepciones<T>[] {
  const porPos = new Map<string, T[]>();
  for (const acepcion of acepciones) {
    const grupo = porPos.get(acepcion.pos);
    if (grupo) grupo.push(acepcion);
    else porPos.set(acepcion.pos, [acepcion]);
  }

  // Las desconocidas no tienen sitio en el orden, así que van al final, y entre
  // ellas se quedan como llegaron.
  const alFinal = ORDEN.size;
  return [...porPos.entries()]
    .sort(([a], [b]) => (ORDEN.get(a) ?? alFinal) - (ORDEN.get(b) ?? alFinal))
    .map(([pos, delGrupo]) => ({ pos, nombre: nombreDeCategoria(pos), acepciones: delGrupo }));
}
