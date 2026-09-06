import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { planBatches, slicePdf } from "@/lib/pdf-slice";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([200, 200]);
  }
  return doc.save();
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
  it("extrae exactamente las páginas pedidas", async () => {
    const sliced = await slicePdf(await makePdf(10), 3, 6);
    const doc = await PDFDocument.load(sliced);
    expect(doc.getPageCount()).toBe(4);
  });

  it("acepta la primera y la última página", async () => {
    const original = await makePdf(10);
    expect((await PDFDocument.load(await slicePdf(original, 1, 1))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await slicePdf(original, 10, 10))).getPageCount()).toBe(1);
  });

  it("falla si el rango se sale del documento", async () => {
    await expect(slicePdf(await makePdf(10), 8, 12)).rejects.toThrow(/10 páginas/);
  });

  it("falla si la página inicial no existe", async () => {
    await expect(slicePdf(await makePdf(10), 0, 3)).rejects.toThrow();
  });
});
