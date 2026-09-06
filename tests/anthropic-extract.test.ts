import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "@/tests/fixtures/extraction-response.json";

const parse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse };
  },
}));

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: (schema: unknown) => ({ schema }),
}));

import { extractTermsFromPdf } from "@/lib/anthropic-extract";

const okResponse = {
  stop_reason: "end_turn",
  parsed_output: fixture,
  usage: { input_tokens: 20_000, output_tokens: 4_000 },
};

const params = { pdfBase64: "JVBERi0=", level: "B2", pageStart: 12, pageEnd: 16 };

describe("extractTermsFromPdf", () => {
  beforeEach(() => parse.mockReset());

  it("devuelve los términos de la respuesta", async () => {
    parse.mockResolvedValue(okResponse);
    const result = await extractTermsFromPdf(params);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].term).toBe("come across");
  });

  it("calcula el coste a partir del consumo", async () => {
    parse.mockResolvedValue(okResponse);
    const result = await extractTermsFromPdf(params);
    expect(result.costUsd).toBeCloseTo(0.2);
    expect(result.inputTokens).toBe(20_000);
  });

  it("envía el PDF como documento antes del texto", async () => {
    parse.mockResolvedValue(okResponse);
    await extractTermsFromPdf(params);
    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe("document");
    expect(content[0].source.media_type).toBe("application/pdf");
    expect(content[0].source.data).toBe("JVBERi0=");
    expect(content[1].type).toBe("text");
  });

  it("usa claude-opus-5", async () => {
    parse.mockResolvedValue(okResponse);
    await extractTermsFromPdf(params);
    expect(parse.mock.calls[0][0].model).toBe("claude-opus-5");
  });

  it("falla con un mensaje claro si la respuesta no se pudo validar", async () => {
    parse.mockResolvedValue({ ...okResponse, parsed_output: null });
    await expect(extractTermsFromPdf(params)).rejects.toThrow(/no devolvió un resultado válido/i);
  });

  it("falla con un mensaje claro si el modelo rechaza la petición", async () => {
    parse.mockResolvedValue({ ...okResponse, stop_reason: "refusal" });
    await expect(extractTermsFromPdf(params)).rejects.toThrow(/rechazó/i);
  });
});
