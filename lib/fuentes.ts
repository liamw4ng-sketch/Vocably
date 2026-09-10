/**
 * Lo que saben a la vez el servidor y el navegador sobre los nombres de fuente.
 *
 * Vive aquí, y no en el repositorio, porque el formulario de la biblioteca es
 * un módulo `"use client"`: importar `db/repository/terms.ts` para leer un
 * número arrastraría el esquema y Drizzle al paquete del navegador. El mismo
 * motivo por el que existe `lib/ajustes.ts`; que siga así.
 */

/**
 * Tope de caracteres del nombre de una fuente. No lo impone la base —la columna
 * es `text`—: es para que un pegado accidental no deje un botón de filtro de
 * mil caracteres que no cabe en la pantalla del móvil.
 */
export const MAXIMO_NOMBRE_DE_FUENTE = 120;

/**
 * Qué le pasa al nombre nuevo que se ha escrito, si es que le pasa algo.
 * Cadena vacía significa que vale. Es la misma comprobación que hace la ruta,
 * aquí solo para poder decirlo sin ir al servidor.
 */
export function errorDeNombreDeFuente(nuevo: string, actual: string): string {
  const limpio = nuevo.trim();
  if (!limpio) return "El nombre no puede quedarse vacío.";
  if (limpio.length > MAXIMO_NOMBRE_DE_FUENTE) {
    return `El nombre no puede pasar de ${MAXIMO_NOMBRE_DE_FUENTE} caracteres.`;
  }
  if (limpio === actual) return "Ese ya es su nombre.";
  return "";
}
