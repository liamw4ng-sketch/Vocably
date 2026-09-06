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
  const body = (await request.json()) as Body;
  const { pdfBase64, title, pageStart, pageEnd, level } = body;

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

  const saved = await saveExtraction(getDb(), {
    title: title.trim(),
    pageStart: pageStart as number,
    pageEnd: pageEnd as number,
    level,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    costUsd: outcome.costUsd,
    items: outcome.items,
  });

  return NextResponse.json({
    items: outcome.items,
    created: saved.created,
    merged: saved.merged,
    costUsd: outcome.costUsd,
  });
}
