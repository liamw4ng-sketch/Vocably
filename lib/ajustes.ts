/**
 * Ajustes que conocen a la vez el servidor y el navegador.
 *
 * Vive aquí, y no en `db/repository/settings.ts`, porque el control del tope
 * en `components/SesionRepaso.tsx` es un módulo `"use client"`: importar el
 * repositorio para leer un número arrastraba `@/db/schema` y
 * `drizzle-orm/pg-core` al paquete del navegador, con los nombres reales de
 * las tablas y columnas dentro y unos 45 KB de más en cada sesión de repaso
 * desde el móvil. Este módulo no importa nada de la base de datos, a
 * propósito: que siga así.
 */

/** Tope máximo de tarjetas nuevas al día: un valor por encima de esto ya no
 * es una preferencia razonable, es un error de digitación. Lo valida
 * `app/api/ajustes/route.ts` y lo usa como límite del control del cliente
 * en `components/SesionRepaso.tsx` — una sola fuente para los dos. */
export const TOPE_MAXIMO_TARJETAS_NUEVAS = 200;

/** Tamaño máximo de una sesión, con el mismo criterio que el tope de nuevas:
 * por encima de esto ya no es una preferencia, es un error de digitación.
 * 0 significa "las que toquen hoy", que es el valor por defecto. */
export const MAXIMO_TAMANO_SESION = 500;

/**
 * Los tres modos de la pantalla previa del repaso. Se definen aquí, y no junto
 * al composer, porque este módulo es el único que pueden importar a la vez el
 * servidor y el navegador sin arrastrar la base de datos detrás.
 */
export const MODOS = ["no-aprendidas", "aprendidas", "mezcla"] as const;
export type Modo = (typeof MODOS)[number];
export const MODO_POR_DEFECTO: Modo = "mezcla";

export function esModo(valor: unknown): valor is Modo {
  return typeof valor === "string" && (MODOS as readonly string[]).includes(valor);
}
