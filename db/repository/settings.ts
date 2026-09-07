import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Database } from "@/db/types";

const FILA = 1;
export const TOPE_POR_DEFECTO = 20;
/** 0 significa "todos los repasos que venzan": la app no recorta por su cuenta. */
export const REPASOS_POR_SESION_POR_DEFECTO = 0;

export type Ajustes = {
  newCardsPerDay: number;
  reviewsPerSession: number;
};

/**
 * Los dos ajustes de una vez. `getDueQueue` los necesita juntos y en la misma
 * petición, así que leerlos por separado serían dos viajes a la base para una
 * tabla de una sola fila.
 */
export async function getAjustes(db: Database): Promise<Ajustes> {
  const filas = await db.select().from(settings).where(eq(settings.id, FILA)).limit(1);
  return {
    newCardsPerDay: filas[0]?.newCardsPerDay ?? TOPE_POR_DEFECTO,
    reviewsPerSession: filas[0]?.reviewsPerSession ?? REPASOS_POR_SESION_POR_DEFECTO,
  };
}

export async function getNewCardsPerDay(db: Database): Promise<number> {
  return (await getAjustes(db)).newCardsPerDay;
}

export async function getReviewsPerSession(db: Database): Promise<number> {
  return (await getAjustes(db)).reviewsPerSession;
}

/**
 * Cada `set` escribe SOLO su columna en el `onConflictDoUpdate`. Si escribiera
 * la fila entera, guardar un ajuste devolvería el otro a su valor por defecto.
 */
export async function setNewCardsPerDay(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tope de tarjetas nuevas debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, newCardsPerDay: valor })
    .onConflictDoUpdate({ target: settings.id, set: { newCardsPerDay: valor } });
}

export async function setReviewsPerSession(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("Los repasos por sesión deben ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, reviewsPerSession: valor })
    .onConflictDoUpdate({ target: settings.id, set: { reviewsPerSession: valor } });
}
