import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";

let pool: Pool | undefined;

/** Conexión perezosa: el módulo se puede importar en pruebas sin DATABASE_URL. */
export function getDb() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return drizzle(pool, { schema });
}
