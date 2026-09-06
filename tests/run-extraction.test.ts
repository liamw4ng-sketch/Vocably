import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { runExtraction } from "@/lib/run-extraction";

async function makePdfBytes(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

const okBatch = { items: [], created: 2, merged: 1, costUsd: 0.05 };

describe("runExtraction", () => {
  it("envía un lote por cada cinco páginas, en orden", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0].pageStart).toBe(1);
    expect(post.mock.calls[0][0].pageEnd).toBe(5);
    expect(post.mock.calls[1][0].pageStart).toBe(6);
  });

  it("suma lo creado, lo fusionado y el coste de todos los lotes", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    const summary = await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post },
    );

    expect(summary.created).toBe(4);
    expect(summary.merged).toBe(2);
    expect(summary.costUsd).toBeCloseTo(0.1);
    expect(summary.failed).toHaveLength(0);
  });

  it("sigue con los siguientes lotes cuando uno falla y lo registra", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(okBatch)
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce(okBatch);

    const summary = await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 15, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(3);
    expect(summary.created).toBe(4);
    expect(summary.failed).toEqual([{ pageStart: 6, pageEnd: 10, error: "502" }]);
  });

  it("avisa del progreso después de cada lote", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    const onProgress = vi.fn();
    await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post, onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });

  it("nunca solapa las llamadas a post: no hay dos lotes en vuelo a la vez (descarta una implementación en paralelo)", async () => {
    // Un post en paralelo (p.ej. batches.map + Promise.all) haría que dos lotes
    // estuvieran pendientes a la vez, lo que en el servidor real duplicaría
    // términos por una carrera en la deduplicación. El fake resuelve de forma
    // asíncrona (setTimeout) para que una implementación paralela sí llegue a
    // solaparse; uno síncrono no demostraría nada.
    let enVuelo = 0;
    let maximoEnVuelo = 0;
    const post = vi.fn().mockImplementation(async () => {
      enVuelo += 1;
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
      await new Promise((resolve) => setTimeout(resolve, 0));
      enVuelo -= 1;
      return okBatch;
    });

    await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 15, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(3);
    expect(maximoEnVuelo).toBe(1);
  });

  it("avisa del progreso en cada lote aunque uno falle, incluido el lote que falla", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(okBatch)
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce(okBatch);
    const onProgress = vi.fn();

    const summary = await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 15, level: "B2" },
      { post, onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 1, total: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { done: 2, total: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(3, { done: 3, total: 3 });
    expect(summary.failed).toHaveLength(1);
  });
});
