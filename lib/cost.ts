/** Precios de claude-opus-5, en dólares por token. */
const INPUT_USD_PER_TOKEN = 5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;

export function estimateCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
}): number {
  return usage.input_tokens * INPUT_USD_PER_TOKEN + usage.output_tokens * OUTPUT_USD_PER_TOKEN;
}
