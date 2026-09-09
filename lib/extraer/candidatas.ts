/** Cuántas palabras seguidas como mucho forma una candidata. */
export const MAXIMO_PALABRAS = 3;

export type Candidata = {
  /** El texto normalizado con el que se consultará el diccionario. */
  texto: string;
  /**
   * La frase del libro en que apareció. Es el contexto de la tarjeta, y lo dice
   * literal: viaja con la sugerencia hasta la pantalla, de ahí a
   * `POST /api/terms` y de ahí a `term_occurrences.context`, que es lo que
   * enseña el repaso debajo de la palabra. Durante un tiempo esto fue una
   * intención y no un hecho —se enseñaba la frase y se guardaba la glosa
   * inglesa—, y la tarjeta salía sin contexto ninguno.
   */
  frase: string;
};

/**
 * Abreviaturas inglesas corrientes cuyo punto no termina la frase. Es una
 * heurística acotada a esta lista corta: cualquier otra abreviatura que no
 * esté aquí seguirá partiendo la frase en dos.
 */
const ABREVIATURAS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e",
]);

/** Una palabra: letras, con apóstrofos (recto o curvo) y guiones dentro. Los números fuera. */
const PALABRA = /[a-zA-Z][a-zA-Z'’-]*/g;

/** Letras y puntos internos inmediatamente antes de una posición, en minúsculas.
 * El punto interno es para reconocer abreviaturas de dos partes como "e.g". */
function palabraAntesDe(texto: string, indice: number): string {
  let inicio = indice;
  while (inicio > 0 && /[a-zA-Z.]/.test(texto[inicio - 1])) {
    inicio -= 1;
  }
  return texto.slice(inicio, indice).toLowerCase();
}

/**
 * Divide el texto en frases, conservando el signo de cierre.
 *
 * El punto es ambiguo: también aparece en decimales ("19.99") y en
 * abreviaturas ("Dr."). Dos reglas, sin adivinar más:
 *
 * (a) Un punto con un dígito justo antes y un dígito justo después no
 *     termina frase: es un punto decimal ("19.99"). Cualquier otro punto
 *     pegado a texto sin espacio detrás —incluidas dos frases reales que un
 *     PDF mal extraído dejó unidas sin espacio— sí termina frase.
 * (b) Un punto que cierra una abreviatura de la lista {@link ABREVIATURAS}
 *     tampoco termina frase. Es una heurística acotada: cualquier otra
 *     abreviatura que no esté en la lista seguirá partiendo la frase en dos.
 *
 * La interrogación y la exclamación no tienen esta ambigüedad y siempre
 * terminan frase, como antes.
 */
function dividirEnFrases(texto: string): string[] {
  const frases: string[] = [];
  let inicio = 0;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c !== "." && c !== "!" && c !== "?") continue;

    if (c === ".") {
      const anterior = texto[i - 1];
      const siguiente = texto[i + 1];
      const esDecimal =
        anterior !== undefined &&
        /[0-9]/.test(anterior) &&
        siguiente !== undefined &&
        /[0-9]/.test(siguiente);
      if (esDecimal) continue; // p. ej. el punto decimal de "19.99"
      if (ABREVIATURAS.has(palabraAntesDe(texto, i))) continue;
    }

    // Una racha de signos de cierre seguidos ("...", "?!") termina junta.
    let fin = i + 1;
    while (fin < texto.length && ".!?".includes(texto[fin])) {
      fin += 1;
    }
    frases.push(texto.slice(inicio, fin));
    inicio = fin;
    i = fin - 1;
  }

  if (inicio < texto.length) {
    frases.push(texto.slice(inicio));
  }

  return frases;
}

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

  for (const bruta of dividirEnFrases(texto)) {
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
