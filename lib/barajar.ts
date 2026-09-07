/**
 * Baraja una copia (Fisher-Yates).
 *
 * `aleatorio` se inyecta en vez de llamar a `Math.random` directamente porque
 * el sorteo decide qué palabras ve el usuario: una prueba que no pueda fijar
 * el azar solo puede comprobar longitudes, no que el sorteo sea correcto.
 */
export function barajar<T>(elementos: readonly T[], aleatorio: () => number = Math.random): T[] {
  const copia = [...elementos];
  for (let i = copia.length - 1; i > 0; i--) {
    // El clamp protege de un generador inyectado que devuelva exactamente 1
    // (Math.random nunca lo hace, pero uno de prueba sí puede): sin él, `j`
    // se saldría del array y el elemento se cambiaría por `undefined`.
    const j = Math.min(i, Math.floor(aleatorio() * (i + 1)));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
