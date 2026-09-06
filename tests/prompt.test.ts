import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "@/lib/prompt";

describe("buildExtractionPrompt", () => {
  it("incluye el nivel pedido", () => {
    expect(buildExtractionPrompt("B2", 12, 18)).toContain("B2");
  });

  it("incluye el rango de páginas", () => {
    const prompt = buildExtractionPrompt("B2", 12, 18);
    expect(prompt).toContain("12");
    expect(prompt).toContain("18");
  });

  it("exige que el término aparezca en el texto", () => {
    expect(buildExtractionPrompt("A2", 1, 5)).toMatch(/literalmente/i);
  });

  it("exige que el contexto sea una frase copiada", () => {
    expect(buildExtractionPrompt("A2", 1, 5)).toMatch(/copiada/i);
  });
});
