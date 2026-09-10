/**
 * Qué español se guarda en el reverso de una tarjeta, y cuándo no hay ninguno.
 *
 * Vive aquí, y no dentro de una pantalla, porque **las dos puertas de entrada a
 * la biblioteca tienen que decidirlo igual**: la del diccionario, palabra a
 * palabra, y la de extraer sin IA, cuarenta de golpe. Estaba escrito solo en
 * `BuscadorDiccionario.tsx` y la pantalla nueva reintrodujo por su cuenta el
 * `join(", ")` que este proyecto ya había desechado. Compartir la escalera es
 * lo que impide que vuelva a pasar.
 *
 * Está en `lib/` y no importado de una pantalla a la otra a propósito: la
 * aplicación se abre desde el icono del móvil, y arrastrar el módulo de la
 * pantalla del diccionario al paquete de la de extraer sería pagar kilobytes
 * por dos funciones de una línea.
 */

/**
 * Qué español se guarda en la tarjeta, por orden de precisión: lo escrito a
 * mano, lo de la acepción, lo de la palabra.
 *
 * Del español de la palabra se guarda **solo el primero**. `deLaPalabra` son
 * hasta cinco definiciones enteras del Wikcionario español, con su punto
 * final y sus comas internas, no equivalentes cortos como los de
 * `deLaAcepcion`: unirlas con `.join(", ")` dejaba reversos como
 * "Idioma., Lengua, lenguaje., Léxico, jerga, vocabulario., …", que es
 * justamente lo que el usuario tendría que estudiar durante meses.
 */
export function traduccionParaGuardar(
  manual: string,
  deLaAcepcion: string[],
  deLaPalabra: string[],
): string {
  return manual.trim() || deLaAcepcion.join(", ") || deLaPalabra[0] || "";
}

/**
 * Si a esta acepción no le llegó español de ningún origen automático: ni el
 * suyo propio (`dictionary_entries.translations`, el volcado inglés o afinar
 * con IA) ni el de su palabra (`spanish_meanings`, Wikcionario o MyMemory).
 * No mira lo escrito a mano: ese campo sigue disponible igual, y este aviso
 * explica por qué hace falta antes de que el usuario lo rellene.
 */
export function sinEspanolEnNingunOrigen(deLaAcepcion: string[], deLaPalabra: string[]): boolean {
  return traduccionParaGuardar("", deLaAcepcion, deLaPalabra) === "";
}
