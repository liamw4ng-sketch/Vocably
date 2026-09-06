import { planBatches, slicePdf, toBase64 } from "@/lib/pdf-slice";

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
 * Recorre el rango en lotes, en secuencia. Cada lote que responde ya está guardado
 * en el servidor: un fallo posterior no deshace lo anterior.
 */
export async function runExtraction(
  input: RunInput,
  callbacks: RunCallbacks,
): Promise<RunSummary> {
  const batches = planBatches(input.pageStart, input.pageEnd);
  const summary: RunSummary = { created: 0, merged: 0, costUsd: 0, failed: [] };

  for (const [index, batch] of batches.entries()) {
    try {
      const sliced = await slicePdf(input.bytes, batch.pageStart, batch.pageEnd);
      const result = await callbacks.post({
        pdfBase64: toBase64(sliced),
        title: input.title,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        level: input.level,
      });
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
