import { cargarEspanol } from "@/db/repository/espanol";
import { lineasDeFicheroGz } from "@/lib/diccionario/lineas";
import { getDb } from "@/db/client";

/**
 * Carga el diccionario español en la base apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-espanol.ts ~/Vocably-diccionario/dicc_es.jsonl.gz
 *
 * Se ejecuta a mano, una vez. No forma parte del arranque de la aplicación ni
 * del despliegue.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del fichero .jsonl.gz del diccionario español.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  // Perezosa a propósito: `cargarEspanol` no empieza a leer hasta haber abierto
  // la transacción. Ver `lineasDeFicheroGz`.
  const inicio = Date.now();
  const { entradas } = await cargarEspanol(getDb(), lineasDeFicheroGz(ruta));
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
