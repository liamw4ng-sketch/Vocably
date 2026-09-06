import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // `push` y `migrate` necesitan la conexión. Se toma de DATABASE_URL, que hay
  // que pasar en el propio comando (el proyecto no usa dotenv), tanto en local
  // como contra producción:
  //   DATABASE_URL='...' npx drizzle-kit push
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
