/**
 * El diccionario habla de categorías gramaticales; la biblioteca, de tres
 * tipos propios. Un verbo de varias palabras es un verbo frasal; cualquier
 * otra cosa de varias palabras, una expresión.
 */
export function tipoDeTermino(
  term: string,
  pos: string,
): "word" | "phrasal_verb" | "expression" {
  if (!term.trim().includes(" ")) return "word";
  return pos === "verb" ? "phrasal_verb" : "expression";
}
