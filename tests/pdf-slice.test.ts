import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { planBatches, slicePdf, toBase64 } from "@/lib/pdf-slice";

// Cada página tiene una anchura única (100 + índice) para poder identificarla
// después de recortar el PDF, y no solo contar cuántas páginas quedaron.
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([100 + i, 200]);
  }
  return doc.save();
}

// Devuelve la "huella" de cada página (su anchura) en el orden en que aparecen.
async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe("planBatches", () => {
  it("agrupa de cinco en cinco", () => {
    expect(planBatches(1, 10)).toEqual([
      { pageStart: 1, pageEnd: 5 },
      { pageStart: 6, pageEnd: 10 },
    ]);
  });

  it("deja el último lote incompleto", () => {
    expect(planBatches(12, 18)).toEqual([
      { pageStart: 12, pageEnd: 16 },
      { pageStart: 17, pageEnd: 18 },
    ]);
  });

  it("devuelve un solo lote para una página", () => {
    expect(planBatches(7, 7)).toEqual([{ pageStart: 7, pageEnd: 7 }]);
  });

  it("rechaza un rango invertido", () => {
    expect(() => planBatches(9, 3)).toThrow();
  });
});

describe("slicePdf", () => {
  it("extrae exactamente las páginas 3 a 6, en orden", async () => {
    const sliced = await slicePdf(await makePdf(10), 3, 6);
    // Las páginas originales 3, 4, 5 y 6 tienen anchuras 102, 103, 104 y 105.
    // Si el recorte estuviera desplazado o invertido, esta secuencia no coincidiría.
    expect(await pageWidths(sliced)).toEqual([102, 103, 104, 105]);
  });

  it("extrae exactamente la primera página", async () => {
    const sliced = await slicePdf(await makePdf(10), 1, 1);
    expect(await pageWidths(sliced)).toEqual([100]);
  });

  it("extrae exactamente la última página", async () => {
    const sliced = await slicePdf(await makePdf(10), 10, 10);
    expect(await pageWidths(sliced)).toEqual([109]);
  });

  it("falla si el rango se sale del documento", async () => {
    await expect(slicePdf(await makePdf(10), 8, 12)).rejects.toThrow(/10 páginas/);
  });

  it("falla si la página inicial no existe", async () => {
    await expect(slicePdf(await makePdf(10), 0, 3)).rejects.toThrow();
  });
});

describe("toBase64", () => {
  it("codifica los 256 valores de byte posibles, incluidos los mayores que 0x7F", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      bytes[i] = i;
    }
    // Buffer.from(...).toString("base64") es una implementación de referencia
    // independiente del bucle String.fromCharCode + btoa que usa toBase64.
    const expected = Buffer.from(bytes).toString("base64");
    expect(toBase64(bytes)).toBe(expected);
  });

  it("hace un round-trip exacto con atob para bytes binarios arbitrarios", () => {
    const bytes = new Uint8Array([0, 1, 2, 63, 64, 65, 127, 128, 129, 200, 254, 255]);
    const encoded = toBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
