import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

/**
 * Las líneas de un `.jsonl.gz`, una a una y **sin abrir el fichero hasta que
 * alguien pida la primera**.
 *
 * Que sea un generador no es un detalle de estilo: es el arreglo. El cuerpo de
 * un generador no corre hasta el primer `next()`, así que `createInterface` no
 * se ejecuta hasta que el consumidor está listo para leer. Con un
 * `readline.createInterface` creado por adelantado pasa lo contrario: empieza a
 * consumir el flujo en cuanto nace, y si quien lo va a recorrer tarda —abrir
 * una transacción y vaciar una tabla, por ejemplo— se bebe las 181.103 líneas
 * contra el suelo. Cuando por fin llega el `for await`, el flujo ya terminó, el
 * iterador se queda esperando un evento que no va a volver a ocurrir, y la
 * carga se cuelga hasta que el servidor mata la conexión por llevar cinco
 * minutos inactiva dentro de la transacción.
 */
export async function* lineasDeFicheroGz(ruta: string): AsyncGenerator<string> {
  const lineas = createInterface({
    input: createReadStream(ruta).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const linea of lineas) yield linea;
}
