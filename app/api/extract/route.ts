import { NextResponse } from "next/server";
import { isCefrLevel } from "@/lib/extraction-schema";
import { extractTermsFromPdf } from "@/lib/anthropic-extract";
import { saveExtraction } from "@/db/repository/extraction";
import { getDb } from "@/db/client";

export const maxDuration = 60;

type Body = {
  pdfBase64?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  level?: string;
};

export async function POST(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }
  const { pdfBase64, title, pageStart, pageEnd, level } = body ?? {};

  if (!pdfBase64) {
    return NextResponse.json({ error: "Falta el PDF." }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: "Falta el título de la fuente." }, { status: 400 });
  }
  if (!level || !isCefrLevel(level)) {
    return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
  }
  if (
    !Number.isInteger(pageStart) ||
    !Number.isInteger(pageEnd) ||
    (pageStart as number) < 1 ||
    (pageEnd as number) < (pageStart as number)
  ) {
    return NextResponse.json({ error: "Rango de páginas no válido." }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await extractTermsFromPdf({
      pdfBase64,
      level,
      pageStart: pageStart as number,
      pageEnd: pageEnd as number,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No se pudo extraer el vocabulario de estas páginas: ${detail}` },
      { status: 502 },
    );
  }

  // La extracción ya está pagada. Si el guardado falla, hay que decirlo con
  // esas palabras: el dinero se ha gastado y los términos se han perdido.
  let saved;
  try {
    saved = await saveExtraction(getDb(), {
      title: title.trim(),
      pageStart: pageStart as number,
      pageEnd: pageEnd as number,
      level,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costUsd: outcome.costUsd,
      items: outcome.items,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      {
        error:
          "El vocabulario se extrajo bien, pero no se pudo guardar en la base de datos, " +
          `así que estas páginas se han cobrado sin guardarse nada: ${detail}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    items: outcome.items,
    created: saved.created,
    merged: saved.merged,
    costUsd: outcome.costUsd,
  });
}
