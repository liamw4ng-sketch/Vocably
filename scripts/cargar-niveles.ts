import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { cargarNiveles } from "@/db/repository/nivel";
import { getDb } from "@/db/client";

/**
 * Lee un fichero de texto línea a línea, y **perezosamente**: el cuerpo de un
 * generador no corre hasta la primera vuelta, así que el fichero no se abre
 * hasta que el cargador está listo para consumirlo. Es la misma precaución que
 * `lib/diccionario/lineas.ts`, escrita allí después de que una carga se colgara
 * cinco minutos por leer el fichero antes de tiempo.
 */
async function* lineasDeFichero(ruta: string): AsyncGenerator<string> {
  const lineas = createInterface({ input: createReadStream(ruta), crlfDelay: Infinity });
  for await (const linea of lineas) yield linea;
}

/**
 * Carga el listado de niveles del MCER en la base apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-niveles.ts ~/Vocably-diccionario/cefr.csv
 *
 * El fichero son los dos CSV del proyecto Open Language Profiles concatenados;
 * el README explica cómo obtenerlos. Se ejecuta a mano, una vez.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del CSV con los niveles.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const inicio = Date.now();
  const { entradas } = await cargarNiveles(getDb(), lineasDeFichero(ruta));
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
