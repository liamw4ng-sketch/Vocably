import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Database } from "@/db/types";
import { esModo, MODO_POR_DEFECTO, SIN_TOPE_DE_NUEVAS, type Modo } from "@/lib/ajustes";

const FILA = 1;
/** Sin tope. Ver `SIN_TOPE_DE_NUEVAS` en `lib/ajustes.ts` para el porqué. */
export const TOPE_POR_DEFECTO = SIN_TOPE_DE_NUEVAS;
/** 0 significa "las que toquen hoy": la app no recorta por su cuenta. */
export const TAMANO_SESION_POR_DEFECTO = 0;

export type Ajustes = {
  newCardsPerDay: number;
  sessionSize: number;
  sessionMode: Modo;
};

/**
 * Los tres ajustes de una vez. `getDueQueue` los necesita juntos y en la misma
 * petición, así que leerlos por separado serían tres viajes a la base para una
 * tabla de una sola fila.
 */
export async function getAjustes(db: Database): Promise<Ajustes> {
  const filas = await db.select().from(settings).where(eq(settings.id, FILA)).limit(1);
  const guardado = filas[0]?.sessionMode;
  return {
    newCardsPerDay: filas[0]?.newCardsPerDay ?? TOPE_POR_DEFECTO,
    sessionSize: filas[0]?.sessionSize ?? TAMANO_SESION_POR_DEFECTO,
    // La columna es `text`: nada en la base impide que llegue una cadena que
    // ya no es un modo válido. Volver al de por defecto es mejor que dejar
    // pasar un valor con el que `componerSesion` no sabría qué hacer.
    sessionMode: esModo(guardado) ? guardado : MODO_POR_DEFECTO,
  };
}

export async function getNewCardsPerDay(db: Database): Promise<number> {
  return (await getAjustes(db)).newCardsPerDay;
}

/**
 * Cada `set` escribe SOLO su columna en el `onConflictDoUpdate`. Si escribiera
 * la fila entera, guardar un ajuste devolvería los otros a su valor por defecto.
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

export async function setSessionSize(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tamaño de la sesión debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, sessionSize: valor })
    .onConflictDoUpdate({ target: settings.id, set: { sessionSize: valor } });
}

export async function setSessionMode(db: Database, modo: Modo): Promise<void> {
  if (!esModo(modo)) {
    throw new Error("El modo de sesión no es uno de los válidos.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, sessionMode: modo })
    .onConflictDoUpdate({ target: settings.id, set: { sessionMode: modo } });
}
