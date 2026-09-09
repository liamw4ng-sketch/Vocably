import { describe, it, expect } from "vitest";
import { textoDePaginas } from "@/lib/extraer/pdf-texto";

const vacio = new Uint8Array([1, 2, 3]);

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
