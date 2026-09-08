import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineasDeFicheroGz } from "@/lib/diccionario/lineas";

let carpeta: string;
let ruta: string;

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), "lineas-"));
  ruta = join(carpeta, "trozo.jsonl.gz");
  writeFileSync(ruta, gzipSync(Buffer.from("uno\ndos\ntres\n", "utf8")));
});

afterAll(() => {
  rmSync(carpeta, { recursive: true, force: true });
});

describe("lineasDeFicheroGz", () => {
  it("descomprime y entrega una línea por vez", async () => {
    const leidas: string[] = [];
    for await (const linea of lineasDeFicheroGz(ruta)) leidas.push(linea);

    expect(leidas).toEqual(["uno", "dos", "tres"]);
  });

  /**
   * La regresión de verdad. `cargarDiccionario` no empieza a iterar en cuanto
   * recibe la fuente: primero abre la transacción y vacía la tabla, y eso son
   * cientos de milisegundos contra la base de datos. Un `readline.createInterface`
   * creado antes de tiempo se bebe el flujo entero mientras tanto y su iterador
   * se queda esperando a un evento que ya pasó: la carga se cuelga hasta que el
   * servidor mata la conexión por inactividad dentro de la transacción.
   *
   * Por eso la fuente tiene que ser perezosa: no abrir el fichero hasta que
   * alguien pida la primera línea.
   */
  it("no se pierde nada aunque quien la consume tarde en empezar a iterar", async () => {
    const fuente = lineasDeFicheroGz(ruta);
    await new Promise((listo) => setTimeout(listo, 50));

    const leidas: string[] = [];
    for await (const linea of fuente) leidas.push(linea);

    expect(leidas).toEqual(["uno", "dos", "tres"]);
  });
});
