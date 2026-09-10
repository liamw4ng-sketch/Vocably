/**
 * Todas las traducciones al español que se le pueden ofrecer a una palabra, en
 * una sola lista y sin repetidos.
 *
 * El usuario la pidió así, revuelta, cuando se le preguntó expresamente si
 * prefería ver las de una acepción junto a su acepción: quiere una lista y
 * elegir él, porque como profesor de idiomas sabe qué traducción va con qué
 * sentido mejor de lo que ninguna regla podría adivinar.
 *
 * **Las de acepción van primero.** Son equivalentes de una palabra —`orilla`,
 * `banco`— y hacen mejor reverso de tarjeta; las de la palabra son definiciones
 * enteras del Wikcionario español, con su punto final. Lo más parecido a una
 * traducción, arriba.
 *
 * La comparación ignora mayúsculas y espacios de sobra para no ofrecer `Banco.`
 * y `banco` como dos opciones distintas, pero **se conserva la primera forma que
 * apareció**: es la que se enseña y la que acaba en la tarjeta.
 */
export function traduccionesPosibles(
  deLasAcepciones: string[][],
  deLaPalabra: string[][],
): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];

  for (const grupo of [...deLasAcepciones, ...deLaPalabra]) {
    for (const cruda of grupo) {
      const traduccion = cruda.trim();
      if (!traduccion) continue;
      const clave = traduccion.toLowerCase().replace(/\s+/g, " ");
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      lista.push(traduccion);
    }
  }

  return lista;
}
