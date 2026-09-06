import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  assertBatchFits,
  runExtraction,
  MAX_BATCH_BYTES,
  type PostBatchBody,
} from "@/lib/run-extraction";

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

  it("rechaza un rango que se sale del PDF antes de enviar (y cobrar) ningún lote", async () => {
    // Pedir 1-20 de un PDF de 8 páginas: los lotes 1-5 y 6-8 son válidos y se
    // cobrarían si la comprobación viviera dentro del bucle, como antes.
    const post = vi.fn().mockResolvedValue(okBatch);

    await expect(
      runExtraction(
        { bytes: await makePdfBytes(8), title: "Libro", pageStart: 1, pageEnd: 20, level: "B2" },
        { post },
      ),
    ).rejects.toThrow(/El PDF tiene 8 páginas y has pedido hasta la 20/);

    expect(post).not.toHaveBeenCalled();
  });

  it("acepta un rango que llega justo hasta la última página", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    const summary = await runExtraction(
      { bytes: await makePdfBytes(8), title: "Libro", pageStart: 1, pageEnd: 8, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(summary.failed).toHaveLength(0);
  });

  it("avisa de un PDF ilegible o cifrado sin gastar nada de API", async () => {
    // PDFDocument.load lanza tanto con bytes que no son un PDF como con un PDF
    // cifrado (EncryptedPDFError); las dos cosas salen por el mismo camino.
    const post = vi.fn().mockResolvedValue(okBatch);

    await expect(
      runExtraction(
        {
          bytes: new Uint8Array([1, 2, 3, 4]),
          title: "Libro",
          pageStart: 1,
          pageEnd: 5,
          level: "B2",
        },
        { post },
      ),
    ).rejects.toThrow(/cifrado o dañado/);

    expect(post).not.toHaveBeenCalled();
  });
});

describe("assertBatchFits", () => {
  function body(pdfBase64: string): PostBatchBody {
    return { pdfBase64, title: "Libro", pageStart: 6, pageEnd: 10, level: "B2" };
  }

  it("deja pasar un lote que cabe en el límite de Vercel", () => {
    expect(() => assertBatchFits(body("JVBERi0="))).not.toThrow();
  });

  it("rechaza un lote más pesado que el límite, diciendo qué páginas y qué hacer", () => {
    // Se comprueba contra el límite real (4,4 MB), no contra uno de mentira:
    // la cadena base64 es ASCII, así que su longitud son bytes exactos.
    const enorme = "A".repeat(MAX_BATCH_BYTES + 1);
    expect(() => assertBatchFits(body(enorme))).toThrow(/páginas 6-10/);
    expect(() => assertBatchFits(body(enorme))).toThrow(/rango más corto/);
  });
});

describe("runExtraction con lotes demasiado pesados", () => {
  it("falla solo el lote que no cabe, sin enviarlo y sin abortar el resto", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    // El cuerpo que se mide es el JSON entero del lote, no solo el PDF: un
    // título gigante lo desborda igual que cinco páginas escaneadas, y así la
    // prueba no necesita fabricar un PDF de 4,5 MB.
    const summary = await runExtraction(
      {
        bytes: await makePdfBytes(20),
        title: "L".repeat(MAX_BATCH_BYTES + 1),
        pageStart: 1,
        pageEnd: 10,
        level: "B2",
      },
      { post },
    );

    expect(post).not.toHaveBeenCalled();
    expect(summary.failed).toHaveLength(2);
    expect(summary.failed[0]).toMatchObject({ pageStart: 1, pageEnd: 5 });
    expect(summary.failed[0].error).toMatch(/4,5 MB/);
    expect(summary.failed[1]).toMatchObject({ pageStart: 6, pageEnd: 10 });
  });
});
