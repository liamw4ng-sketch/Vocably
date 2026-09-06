import { PDFDocument } from "pdf-lib";

export const BATCH_SIZE = 5;

export function planBatches(
  pageStart: number,
  pageEnd: number,
  size: number = BATCH_SIZE,
): Array<{ pageStart: number; pageEnd: number }> {
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1) {
    throw new Error("El rango de páginas no es válido.");
  }
  if (pageEnd < pageStart) {
    throw new Error("La página final no puede ser anterior a la inicial.");
  }

  const batches: Array<{ pageStart: number; pageEnd: number }> = [];
  for (let start = pageStart; start <= pageEnd; start += size) {
    batches.push({ pageStart: start, pageEnd: Math.min(start + size - 1, pageEnd) });
  }
  return batches;
}

/** Devuelve un PDF nuevo con solo el rango pedido. Las páginas se cuentan desde 1. */
export async function slicePdf(
  bytes: Uint8Array,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();

  if (pageStart < 1 || pageEnd < pageStart) {
    throw new Error("El rango de páginas no es válido.");
  }
  if (pageEnd > total) {
    throw new Error(`El PDF tiene ${total} páginas y has pedido hasta la ${pageEnd}.`);
  }

  const target = await PDFDocument.create();
  const indices = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart - 1 + i);
  const copied = await target.copyPages(source, indices);
  for (const page of copied) {
    target.addPage(page);
  }
  return target.save();
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
