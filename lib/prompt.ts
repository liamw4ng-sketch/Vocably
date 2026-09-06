export function buildExtractionPrompt(
  level: string,
  pageStart: number,
  pageEnd: number,
): string {
  return [
    `Analiza las páginas ${pageStart} a ${pageEnd} del PDF adjunto.`,
    "",
    `Extrae exclusivamente el vocabulario, los verbos frasales y las expresiones clave`,
    `que correspondan a un nivel ${level} según el MCER.`,
    "",
    "Reglas obligatorias:",
    `- Cada término debe aparecer literalmente en las páginas adjuntas. No añadas vocabulario que no esté en ellas.`,
    `- "context" debe ser una frase corta copiada literalmente del texto, no redactada por ti.`,
    `- "example" debe ser una frase nueva tuya que muestre el término en uso, distinta de la del texto.`,
    `- La traducción va al español de España.`,
    `- Clasifica cada entrada como word, phrasal_verb o expression.`,
    `- Si en estas páginas no hay nada del nivel ${level}, devuelve una lista vacía.`,
  ].join("\n");
}
