/**
 * Los destinos de la barra inferior y las dos decisiones que la gobiernan.
 *
 * Vive aquí, y no dentro del componente, por lo mismo que `lib/ajustes.ts`:
 * es lo que a la vez pinta el navegador y comprueban las pruebas, y no
 * necesita React para nada. No importar nada de la base de datos.
 */

export type Destino = {
  href: string;
  etiqueta: string;
};

/**
 * El orden es el del uso, no el alfabético: el repaso es lo que se abre a
 * diario —el manifiesto arranca ahí— y extraer es lo más ocasional, además de
 * lo único que cuesta dinero. Puestos a rozar un destino sin querer con el
 * pulgar, que sea el que no gasta.
 */
export const DESTINOS: readonly Destino[] = [
  { href: "/repaso", etiqueta: "Repaso" },
  { href: "/biblioteca", etiqueta: "Biblioteca" },
  { href: "/diccionario", etiqueta: "Diccionario" },
  { href: "/extraer", etiqueta: "Extraer" },
];

/** Sin la barra final, salvo que el camino sea solo esa barra. */
function normalizar(camino: string): string {
  return camino.length > 1 && camino.endsWith("/") ? camino.slice(0, -1) : camino;
}

/**
 * La barra sale en los cuatro destinos y en ningún sitio más.
 *
 * Es una lista blanca a propósito: con una lista negra («en todo menos en
 * `/login`»), cualquier pantalla que se añada mañana heredaría una barra con
 * ninguna pestaña marcada, que es peor que no tener barra.
 */
export function muestraBarra(camino: string): boolean {
  const limpio = normalizar(camino);
  return DESTINOS.some((destino) => destino.href === limpio);
}

/**
 * Comparación exacta, no por prefijo: `startsWith` haría que estando en
 * `/repaso-viejo` se marcara `/repaso`, y que una futura `/biblioteca-vieja`
 * marcara `/biblioteca`. Ninguna pantalla de esta aplicación tiene subrutas,
 * así que la igualdad basta y no miente.
 */
export function esRutaActiva(camino: string, href: string): boolean {
  return normalizar(camino) === normalizar(href);
}

