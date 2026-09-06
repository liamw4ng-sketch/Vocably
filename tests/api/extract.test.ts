import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "@/tests/fixtures/extraction-response.json";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { terms } from "@/db/schema";

// vi.hoisted es necesario aquí: vi.mock se eleva por encima de este módulo,
// así que la referencia a extractTermsFromPdf debe elevarse con él.
const extractTermsFromPdf = vi.hoisted(() => vi.fn());
let testDb: TestDb;

vi.mock("@/lib/anthropic-extract", () => ({ extractTermsFromPdf }));
vi.mock("@/db/client", () => ({ getDb: () => testDb }));

import { POST } from "@/app/api/extract/route";

function request(body: unknown) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  pdfBase64: "JVBERi0=",
  title: "Cambridge B2 First",
  pageStart: 12,
  pageEnd: 16,
  level: "B2",
};

describe("POST /api/extract", () => {
  beforeEach(async () => {
    extractTermsFromPdf.mockReset();
    testDb = (await createTestDb()).db;
  });

  it("extrae y guarda los términos del lote", async () => {
    extractTermsFromPdf.mockResolvedValue({
      items: fixture.terms,
      inputTokens: 20_000,
      outputTokens: 4_000,
      costUsd: 0.2,
    });

    const response = await POST(request(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(3);
    expect(body.merged).toBe(0);
    expect(body.costUsd).toBeCloseTo(0.2);
    expect(await testDb.select().from(terms)).toHaveLength(3);
  });

  it("rechaza un nivel que no es del MCER", async () => {
    const response = await POST(request({ ...validBody, level: "B3" }));
    expect(response.status).toBe(400);
    expect(extractTermsFromPdf).not.toHaveBeenCalled();
  });

  it("rechaza un rango de páginas invertido", async () => {
    const response = await POST(request({ ...validBody, pageStart: 20, pageEnd: 12 }));
    expect(response.status).toBe(400);
    expect(extractTermsFromPdf).not.toHaveBeenCalled();
  });

  it("rechaza una petición sin PDF", async () => {
    const response = await POST(request({ ...validBody, pdfBase64: "" }));
    expect(response.status).toBe(400);
  });

  it("devuelve 502 y un mensaje legible si la API falla", async () => {
    extractTermsFromPdf.mockRejectedValue(new Error("connection reset"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/no se pudo extraer/i);
  });

  it("acepta un lote sin ningún término del nivel pedido", async () => {
    extractTermsFromPdf.mockResolvedValue({
      items: [],
      inputTokens: 5_000,
      outputTokens: 20,
      costUsd: 0.025,
    });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
  });
});
