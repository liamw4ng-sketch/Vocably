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

/** Tope máximo de repasos por sesión, con el mismo criterio: por encima de
 * esto ya no es una preferencia, es un error de digitación. 0 significa
 * "todos los que venzan", que es el valor por defecto. */
export const MAXIMO_REPASOS_POR_SESION = 500;
