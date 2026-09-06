import { getPdfPageCount, planBatches, slicePdf, toBase64 } from "@/lib/pdf-slice";

export type BatchResponse = {
  items: unknown[];
  created: number;
  merged: number;
  costUsd: number;
};

export type RunInput = {
  bytes: Uint8Array;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
};

export type RunSummary = {
  created: number;
  merged: number;
  costUsd: number;
  failed: Array<{ pageStart: number; pageEnd: number; error: string }>;
};

export type PostBatchBody = {
  pdfBase64: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
};

export type RunCallbacks = {
  post: (body: PostBatchBody) => Promise<BatchResponse>;
  onProgress?: (progress: { done: number; total: number }) => void;
};

/**
 * Vercel corta el cuerpo de una petición a una función de servidor en 4,5 MB.
 * Dejamos un margen para las cabeceras y el resto del JSON del lote.
 */
export const MAX_BATCH_BYTES = 4_400_000;

/** Bytes reales que ocupará el cuerpo JSON del lote al enviarlo. */
export function batchBodyBytes(body: PostBatchBody): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/**
 * Comprueba que el lote cabe en una petición antes de enviarlo. Si no cabe, el
 * servidor responde un 413 que no es JSON y el error llega al usuario como
 * "error desconocido"; mejor pararlo aquí con un mensaje que diga qué hacer.
 */
export function assertBatchFits(body: PostBatchBody, limit: number = MAX_BATCH_BYTES): void {
  const bytes = batchBodyBytes(body);
  if (bytes <= limit) return;

  const mb = (bytes / 1_000_000).toFixed(1);
  throw new Error(
    `Las páginas ${body.pageStart}-${body.pageEnd} ocupan ${mb} MB y el servidor solo admite 4,5 MB por lote. ` +
      "Suelen ser páginas escaneadas a mucha resolución: vuelve a lanzar este trozo con un rango más corto.",
  );
}

/**
 * Recorre el rango en lotes, en secuencia. Cada lote que responde ya está guardado
 * en el servidor: un fallo posterior no deshace lo anterior.
 *
 * El rango se valida contra el PDF real *antes* de empezar: pedir las páginas
 * 12-180 de un libro de 100 no debe cobrar los primeros lotes para fallar en
 * todos los demás.
 */
export async function runExtraction(
  input: RunInput,
  callbacks: RunCallbacks,
): Promise<RunSummary> {
  const batches = planBatches(input.pageStart, input.pageEnd);

  const total = await getPdfPageCount(input.bytes);
  if (input.pageEnd > total) {
    throw new Error(
      `El PDF tiene ${total} ${total === 1 ? "página" : "páginas"} y has pedido hasta la ${input.pageEnd}. ` +
        "Corrige el rango: no se ha enviado nada a la API.",
    );
  }

  const summary: RunSummary = { created: 0, merged: 0, costUsd: 0, failed: [] };

  for (const [index, batch] of batches.entries()) {
    try {
      const sliced = await slicePdf(input.bytes, batch.pageStart, batch.pageEnd);
      const body: PostBatchBody = {
        pdfBase64: toBase64(sliced),
        title: input.title,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        level: input.level,
      };
      // Solo se cae este lote: los demás siguen su curso.
      assertBatchFits(body);

      const result = await callbacks.post(body);
      summary.created += result.created;
      summary.merged += result.merged;
      summary.costUsd += result.costUsd;
    } catch (error) {
      summary.failed.push({
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        error: error instanceof Error ? error.message : "error desconocido",
      });
    }
    callbacks.onProgress?.({ done: index + 1, total: batches.length });
  }

  return summary;
}
