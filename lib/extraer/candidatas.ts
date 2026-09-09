/** Cuántas palabras seguidas como mucho forma una candidata. */
export const MAXIMO_PALABRAS = 3;

export type Candidata = {
  /** El texto normalizado con el que se consultará el diccionario. */
  texto: string;
  /** La frase del libro en que apareció. Es el contexto de la tarjeta. */
  frase: string;
};

/** Corta por punto, interrogación y exclamación, conservando el signo. */
const FIN_DE_FRASE = /[^.!?]+[.!?]*/g;
/** Una palabra: letras, con apóstrofos y guiones dentro. Los números fuera. */
const PALABRA = /[a-zA-Z][a-zA-Z''-]*/g;

/**
 * Parte un texto en candidatas: cada palabra suelta y cada grupo contiguo de
 * dos y tres palabras, con la frase en que aparecieron.
 *
 * **Los grupos son lo que encuentra los verbos frasales y las expresiones.** No
 * se analiza la gramática —frágil y cara— sino que se le pregunta después al
 * diccionario, que ya sabe cuáles existen de verdad: trae 20.012 verbos
 * frasales. El precio es que «gave it up», con la partícula separada, no se
 * reconoce; está aceptado en la especificación §10.
 *
 * Los grupos **no cruzan el final de una frase**: unir «arrived» con «then» a
 * través de un punto podría inventarse un verbo frasal que el texto no tiene.
 *
 * Cada texto distinto sale **una sola vez**, con la frase de su primera
 * aparición: es la que el usuario verá, y repetirla no añade nada.
 */
export function candidatasDeTexto(texto: string): Candidata[] {
  const candidatas: Candidata[] = [];
  const vistas = new Set<string>();

  for (const bruta of texto.match(FIN_DE_FRASE) ?? []) {
    const frase = bruta.trim();
    if (!frase) continue;

    const palabras = (frase.match(PALABRA) ?? []).map((p) => p.toLowerCase());

    for (let inicio = 0; inicio < palabras.length; inicio += 1) {
      for (let largo = 1; largo <= MAXIMO_PALABRAS; largo += 1) {
        if (inicio + largo > palabras.length) break;
        const texto = palabras.slice(inicio, inicio + largo).join(" ");
        if (vistas.has(texto)) continue;
        vistas.add(texto);
        candidatas.push({ texto, frase });
      }
    }
  }

  return candidatas;
}
