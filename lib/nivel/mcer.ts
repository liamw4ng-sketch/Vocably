import { normalizeTerm } from "@/lib/normalize";

/** Los seis niveles del MCER, de menos a más. El orden **es** la escala. */
export const NIVELES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type Nivel = (typeof NIVELES)[number];

export function esNivel(valor: unknown): valor is Nivel {
  return typeof valor === "string" && (NIVELES as readonly string[]).includes(valor);
}

/** Si una palabra de este nivel entra cuando el suelo del filtro es `suelo`. */
export function alcanzaElSuelo(nivel: Nivel, suelo: Nivel): boolean {
  return NIVELES.indexOf(nivel) >= NIVELES.indexOf(suelo);
}

/**
 * El listado del MCER y el diccionario del proyecto nombran distinto la misma
 * categoría gramatical: `adjective` frente a `adj`. **Guardar la cruda dejaría
 * a cada palabra sin poder casar con su ficha del diccionario**, que es
 * justamente lo que el filtro necesita cruzar.
 *
 * Devuelve `null` cuando no sabe traducirla: es mejor perder una fila que
 * inventarse una categoría que el diccionario no usa.
 */
const CATEGORIAS = new Map<string, string>([
  ["noun", "noun"],
  ["adjective", "adj"],
  ["verb", "verb"],
  ["adverb", "adv"],
  ["pronoun", "pron"],
  ["preposition", "prep"],
  ["determiner", "det"],
  ["conjunction", "conj"],
  ["number", "num"],
  ["interjection", "intj"],
  // Las cinco variantes verbales del listado son, para el diccionario, verbos.
  ["modal auxiliary", "verb"],
  ["be-verb", "verb"],
  ["do-verb", "verb"],
  ["have-verb", "verb"],
  ["infinitive-to", "verb"],
  // El volcado trae una única fila que dice `vern`: errata clara de `verb`. Se
  // trata a propósito para que nadie la "arregle" mal dentro de seis meses.
  ["vern", "verb"],
]);

export function categoriaDelProyecto(pos: string): string | null {
  return CATEGORIAS.get(pos.trim().toLowerCase()) ?? null;
}

export type FilaNivel = {
  termNormalized: string;
  term: string;
  pos: string;
  level: Nivel;
};

/**
 * Una línea del CSV del listado se convierte en una o varias filas.
 *
 * **Varias** porque 213 entradas traen las grafías alternativas separadas por
 * barra (`airplane/aeroplane`); sin desdoblarlas, la mitad de esas palabras se
 * quedaría sin nivel.
 *
 * Solo se leen las **tres primeras columnas**. De la cuarta en adelante hay
 * comas dentro de comillas, pero ningún headword lleva coma —comprobado sobre
 * los dos ficheros—, así que cortar por comas y quedarse con los tres primeros
 * trozos es seguro y no hace falta un analizador de CSV.
 *
 * Devuelve lista vacía ante cualquier línea que no sirva, incluida la cabecera:
 * una línea mala no puede abortar una carga de 9.935.
 */
export function filasDeLineaMcer(linea: string): FilaNivel[] {
  const trozos = linea.split(",");
  if (trozos.length < 3) return [];

  const [crudo, pos, nivel] = trozos;
  const level = nivel.trim().toUpperCase();
  if (!esNivel(level)) return [];

  const categoria = categoriaDelProyecto(pos);
  if (!categoria) return [];

  const filas: FilaNivel[] = [];
  const vistas = new Set<string>();
  for (const variante of crudo.split("/")) {
    const term = variante.trim();
    if (!term) continue;
    const termNormalized = normalizeTerm(term);
    if (!termNormalized || vistas.has(termNormalized)) continue;
    vistas.add(termNormalized);
    filas.push({ termNormalized, term, pos: categoria, level });
  }
  return filas;
}
