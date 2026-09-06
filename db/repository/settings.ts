import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Database } from "@/db/types";

const FILA = 1;
export const TOPE_POR_DEFECTO = 20;

export async function getNewCardsPerDay(db: Database): Promise<number> {
  const filas = await db.select().from(settings).where(eq(settings.id, FILA)).limit(1);
  return filas[0]?.newCardsPerDay ?? TOPE_POR_DEFECTO;
}

export async function setNewCardsPerDay(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tope de tarjetas nuevas debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, newCardsPerDay: valor })
    .onConflictDoUpdate({ target: settings.id, set: { newCardsPerDay: valor } });
}
