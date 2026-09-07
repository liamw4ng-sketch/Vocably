import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { estimateCostUsd } from "@/lib/cost";

export const afinarSchema = z.object({
  translations: z.array(z.string()).min(1).max(4),
});

/** Lo mínimo que hace falta de un cliente de Anthropic, para poder inyectarlo. */
type ClienteAfinar = {
  messages: {
    parse: (params: Record<string, unknown>) => Promise<{
      stop_reason?: string | null;
      parsed_output: z.infer<typeof afinarSchema> | null;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
};

/**
 * El único punto de todo el diccionario que cuesta dinero, y solo se llega aquí
 * si el usuario pulsa el botón.
 *
 * Se manda el término **con su significado en inglés**, que es lo que resuelve
 * la ambigüedad: sin él, "bank" devuelve la acepción financiera y punto. Esto
 * es exactamente lo contrario que con el traductor automático, donde pegar la
 * definición rompía el resultado; un modelo de lenguaje sí sabe distinguir un
 * contexto de un texto a traducir.
 */
export async function afinarTraduccion(params: {
  term: string;
  gloss: string;
  cliente?: ClienteAfinar;
}): Promise<{ translations: string[]; costUsd: number }> {
  const cliente = params.cliente ?? (new Anthropic() as unknown as ClienteAfinar);

  const respuesta = await cliente.messages.parse({
    model: "claude-opus-5",
    // En claude-opus-5 el pensamiento adaptativo está activo por defecto y sus
    // tokens cuentan contra max_tokens: 1000 se queda corto y devolvería
    // parsed_output nulo con la respuesta cortada a medias.
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content:
          `Término en inglés: ${params.term}\n` +
          `Significado, en inglés: ${params.gloss}\n\n` +
          "Da las traducciones al español de ese término **en esa acepción concreta**: " +
          "las que un profesor pondría en una tarjeta de vocabulario. " +
          "Entre una y cuatro, de más a menos habitual. Solo las traducciones, sin explicaciones.",
      },
    ],
    // Traducir un término con su significado delante es una tarea trivial:
    // effort "low" mantiene barato el único punto de pago del diccionario.
    output_config: { format: zodOutputFormat(afinarSchema), effort: "low" },
  });

  if (respuesta.stop_reason === "refusal") {
    throw new Error("El modelo rechazó la petición para este término.");
  }

  if (!respuesta.parsed_output) {
    throw new Error("El modelo no devolvió una traducción válida para este término.");
  }

  const usage = {
    input_tokens: respuesta.usage.input_tokens,
    output_tokens: respuesta.usage.output_tokens,
  };

  return {
    translations: respuesta.parsed_output.translations,
    costUsd: estimateCostUsd(usage),
  };
}
