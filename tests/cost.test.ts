import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "@/lib/cost";

describe("estimateCostUsd", () => {
  it("cobra 5 $ por millón de tokens de entrada", () => {
    expect(estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(5);
  });

  it("cobra 25 $ por millón de tokens de salida", () => {
    expect(estimateCostUsd({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(25);
  });

  it("suma entrada y salida", () => {
    expect(estimateCostUsd({ input_tokens: 20_000, output_tokens: 4_000 })).toBeCloseTo(0.2);
  });

  it("devuelve cero sin consumo", () => {
    expect(estimateCostUsd({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});
