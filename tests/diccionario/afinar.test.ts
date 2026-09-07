import { describe, it, expect, vi } from "vitest";
import { afinarTraduccion } from "@/lib/diccionario/afinar";

const respuesta = {
  parsed_output: { translations: ["reacio", "poco dispuesto"] },
  usage: { input_tokens: 120, output_tokens: 30 },
};

// Tipado explícito de `vi.fn`: sin esto, TypeScript infiere una función sin
// parámetros y `mock.calls[0]` queda como una tupla vacía que no se puede
// indexar, igual que ya pasa en tests/buscador-diccionario.test.ts.
type ParseFn = (params: Record<string, unknown>) => Promise<{
  stop_reason?: string;
  parsed_output: { translations: string[] } | null;
  usage: { input_tokens: number; output_tokens: number };
}>;

describe("afinarTraduccion", () => {
  it("manda el término con su significado y devuelve las traducciones", async () => {
    const parse = vi.fn<ParseFn>(async () => respuesta);
    const resultado = await afinarTraduccion({
      term: "reluctant",
      gloss: "Not wanting to take some action.",
      cliente: { messages: { parse } },
    });

    expect(resultado.translations).toEqual(["reacio", "poco dispuesto"]);
    const enviado = JSON.stringify(parse.mock.calls[0][0]);
    expect(enviado).toContain("reluctant");
    expect(enviado).toContain("Not wanting to take some action.");
  });

  it("calcula el coste con los precios de claude-opus-5", async () => {
    const parse = vi.fn<ParseFn>(async () => respuesta);
    const { costUsd } = await afinarTraduccion({
      term: "reluctant",
      gloss: "x",
      cliente: { messages: { parse } },
    });
    // 120 * 5/1e6 + 30 * 25/1e6
    expect(costUsd).toBeCloseTo(0.00135, 8);
  });

  it("usa claude-opus-5 con margen de tokens de sobra para el pensamiento adaptativo", async () => {
    const parse = vi.fn<ParseFn>(async () => respuesta);
    await afinarTraduccion({ term: "reluctant", gloss: "x", cliente: { messages: { parse } } });

    const enviado = parse.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.model).toBe("claude-opus-5");
    // 1000 se queda corto: en claude-opus-5 el pensamiento adaptativo cuenta
    // contra max_tokens y cortaría la respuesta antes de devolver JSON válido.
    expect(enviado.max_tokens).toBe(8000);
    expect(enviado.thinking).toEqual({ type: "adaptive" });
  });

  it("manda el formato estructurado con effort bajo dentro de output_config", async () => {
    const parse = vi.fn<ParseFn>(async () => respuesta);
    await afinarTraduccion({ term: "reluctant", gloss: "x", cliente: { messages: { parse } } });

    const enviado = parse.mock.calls[0][0] as Record<string, unknown>;
    const outputConfig = enviado.output_config as Record<string, unknown>;
    expect(outputConfig.effort).toBe("low");
    expect(outputConfig.format).toBeDefined();
    // output_format (el nombre viejo, un solo nivel) no debe aparecer: el SDK
    // 0.124 lo tiene deprecado y espera output_config.format.
    expect(enviado.output_format).toBeUndefined();
  });

  it("falla con un mensaje en español si el modelo rechaza la petición", async () => {
    const parse = vi.fn<ParseFn>(async () => ({ ...respuesta, stop_reason: "refusal" }));
    await expect(
      afinarTraduccion({ term: "reluctant", gloss: "x", cliente: { messages: { parse } } }),
    ).rejects.toThrow(/rechazó/i);
  });

  it("falla con un mensaje en español si no hay parsed_output", async () => {
    const parse = vi.fn<ParseFn>(async () => ({ ...respuesta, parsed_output: null }));
    await expect(
      afinarTraduccion({ term: "reluctant", gloss: "x", cliente: { messages: { parse } } }),
    ).rejects.toThrow(/no devolvió una traducción válida/i);
  });
});
