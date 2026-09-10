/**
 * Qué español se guarda en el reverso de una tarjeta, y cuándo no hay ninguno.
 *
 * Nació aquí porque las dos puertas de entrada a la biblioteca tenían que
 * decidir el español igual: la del diccionario, palabra a palabra, y la de
 * extraer sin IA, cuarenta de golpe. Desde que el diccionario dejó de
 * calcular la traducción y pasó a que el usuario la elija de una lista
 * (`components/BuscadorDiccionario.tsx`, con `traduccionesPosibles` y
 * `conTraduccionesAfinadas`), esa puerta ya no la usa: hoy el único
 * consumidor es `components/ExtraerSinIA.tsx`.
 *
 * Sigue en `lib/` aunque le quede un solo consumidor: es donde viven el resto
 * de funciones puras del diccionario que se prueban sin jsdom
 * (`traducciones-posibles.ts`, `categoria.ts`), y sus pruebas
 * (`tests/diccionario/traduccion.test.ts`) ya están ahí. Moverla a
 * `components/ExtraerSinIA.tsx` solo por tener un único consumidor rompería
 * esa convención sin arreglar nada.
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
