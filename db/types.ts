import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

/**
 * Cualquier instancia de Drizzle sobre este esquema: la de producción y la de
 * pruebas en memoria. Los repositorios dependen de este tipo y nunca de una
 * conexión concreta, para que el código de producción no importe nada de tests/.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
