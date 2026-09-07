import { NextResponse } from "next/server";
import { listTerms } from "@/db/repository/terms";
import { anadirDesdeDiccionario } from "@/db/repository/diccionario";
import { isCefrLevel } from "@/lib/extraction-schema";
import { getDb } from "@/db/client";

function esString(valor: unknown): valor is string {
  return typeof valor === "string";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await listTerms(getDb(), {
    level: url.searchParams.get("level") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  return NextResponse.json({ terms: rows });
}

type PostBody = {
  term?: string;
  pos?: string;
  gloss?: string;
  example?: string | null;
  translation?: string;
  level?: string;
};

export async function POST(request: Request) {
  let body: PostBody | null;
  try {
    body = (await request.json()) as PostBody | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { term, pos, gloss, example, translation, level } = body ?? {};

  if (!esString(term) || !term.trim() || !esString(pos) || !pos.trim() || !esString(gloss) || !gloss.trim()) {
    return NextResponse.json({ error: "Falta el término, su categoría o su significado." }, { status: 400 });
  }
  if (!esString(translation) || !translation.trim()) {
    return NextResponse.json({ error: "Falta la traducción." }, { status: 400 });
  }
  if (example !== undefined && example !== null && !esString(example)) {
    return NextResponse.json({ error: "El ejemplo debe ser una cadena." }, { status: 400 });
  }
  // Sin nivel no se guarda: es la decisión del usuario, y un valor por defecto
  // llenaría la biblioteca de niveles que nadie ha elegido.
  if (!level || !isCefrLevel(level)) {
    return NextResponse.json({ error: "Elige un nivel del MCER." }, { status: 400 });
  }

  const resultado = await anadirDesdeDiccionario(getDb(), {
    term: term.trim(),
    pos,
    gloss: gloss.trim(),
    example: example?.trim() || null,
    translation: translation.trim(),
    level,
  });

  return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 });
}
