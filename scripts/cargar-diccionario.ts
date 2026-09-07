import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { cargarDiccionario } from "@/db/repository/diccionario";
import { getDb } from "@/db/client";

/**
 * Carga el diccionario en la base de datos apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-diccionario.ts ~/Vocably-diccionario/dicc_todo.jsonl.gz
 *
 * Se ejecuta a mano, una vez. No forma parte del arranque de la aplicación ni
 * del despliegue: el diccionario no cambia.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del fichero .jsonl.gz del diccionario.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const lineas = createInterface({
    input: createReadStream(ruta).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const inicio = Date.now();
  const { entradas, filas } = await cargarDiccionario(getDb(), lineas);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas (${filas} acepciones) en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
