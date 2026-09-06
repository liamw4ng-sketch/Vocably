import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema } from "@/lib/extraction-schema";
import { buildExtractionPrompt } from "@/lib/prompt";
import { estimateCostUsd } from "@/lib/cost";
import type { ExtractedTerm } from "@/db/repository/extraction";

export type ExtractionOutcome = {
  items: ExtractedTerm[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export async function extractTermsFromPdf(params: {
  pdfBase64: string;
  level: string;
  pageStart: number;
  pageEnd: number;
}): Promise<ExtractionOutcome> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: params.pdfBase64,
            },
          },
          {
            type: "text",
            text: buildExtractionPrompt(params.level, params.pageStart, params.pageEnd),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(extractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("El modelo rechazó la petición para estas páginas.");
  }

  if (!response.parsed_output) {
    throw new Error("El modelo no devolvió un resultado válido para estas páginas.");
  }

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };

  return {
    items: response.parsed_output.terms,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: estimateCostUsd(usage),
  };
}
