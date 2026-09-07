import { normalizeTerm } from "@/lib/normalize";

/**
 * Wikcionario lemmatiza los idioms en tercera persona impersonal ("one"), y la
 * gente los escribe en segunda ("you"). Sin esto, buscar
 * "bite off more than you can chew" no encuentra nada: la ficha existe, pero
 * guardada como "...more than one can chew".
 */
const PARES: ReadonlyArray<readonly [string, string]> = [
  ["you", "one"],
  ["your", "one's"],
  ["yourself", "oneself"],
  ["yourselves", "oneself"],
  ["someone", "somebody"],
];

function sustituir(termino: string, de: string, a: string): string {
  // \b no sirve con apóstrofo ("one's"), así que el límite se hace a mano:
  // principio/fin de cadena o un carácter que no sea de palabra ni apóstrofo.
  const patron = new RegExp(`(^|[^\\w'])${de}(?=$|[^\\w'])`, "g");
  return termino.replace(patron, (_coincidencia, prefijo: string) => `${prefijo}${a}`);
}

export function variantesDelLema(termino: string): string[] {
  const base = normalizeTerm(termino);

  // Dos pasadas completas, no todas las combinaciones: un idiom mezcla las dos
  // familias muy raramente, y generar el producto cartesiano multiplicaría las
  // consultas sin encontrar nada más.
  let haciaOne = base;
  let haciaYou = base;
  for (const [you, one] of PARES) {
    haciaOne = sustituir(haciaOne, you, one);
    haciaYou = sustituir(haciaYou, one, you);
  }

  const vistas = new Set<string>();
  return [base, haciaOne, haciaYou].filter((v) => {
    if (vistas.has(v)) return false;
    vistas.add(v);
    return true;
  });
}
