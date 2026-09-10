import { describe, it, expect } from "vitest";
import { textoDePaginas } from "@/lib/extraer/pdf-texto";

const vacio = new Uint8Array([1, 2, 3]);

// El caso "el PDF se abre bien pero el rango pedido se sale de sus páginas
// reales" y el caso "el PDF se abre bien pero falla al analizar una página
// en concreto" necesitan que `pdfjs.getDocument(...).promise` resuelva con
// éxito. Un PDF real y válido no sirve para probarlo aquí: en este entorno
// (Vitest sobre Node, sin bundler) la resolución de `workerSrc` con
// `new URL("pdfjs-dist/...", import.meta.url)` no funciona igual que en el
// navegador empaquetado por Turbopack, así que incluso un PDF perfectamente
// válido falla al abrirse con "Setting up fake worker failed". Por eso esos
// dos casos están en tests/extraer/pdf-texto-lector-simulado.test.ts, con un
// `pdfjs-dist` simulado. Aquí solo quedan los casos que sí ejercitan el
// lector real: el rango imposible (que ni lo toca) y el PDF ilegible (que
// falla antes de necesitar el worker).
describe("textoDePaginas", () => {
  /**
   * El rango se valida antes de tocar el PDF: un rango imposible no debe
   * gastar el tiempo de cargar el lector, que pesa medio mega.
   */
  it("rechaza un rango imposible sin cargar el lector", async () => {
    await expect(textoDePaginas(vacio, 0, 5)).rejects.toThrow(/rango/i);
    await expect(textoDePaginas(vacio, 5, 2)).rejects.toThrow(/rango/i);
    await expect(textoDePaginas(vacio, 1.5, 3)).rejects.toThrow(/rango/i);
  });

  /**
   * Un PDF ilegible tiene que dar un mensaje que el usuario entienda, no la
   * excepción interna del lector.
   */
  it("un PDF que no se puede abrir da un mensaje en español", async () => {
    await expect(textoDePaginas(vacio, 1, 1)).rejects.toThrow(/no se pudo leer el pdf/i);
  });
});
