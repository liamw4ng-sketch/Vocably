/** Clave de comparación de términos: dos términos con la misma clave son el mismo. */
export function normalizeTerm(term: string): string {
  return term.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}
