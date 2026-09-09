import { NextResponse } from "next/server";
import { listTerms } from "@/db/repository/terms";
import { anadirDesdeDiccionario, anadirVariasDesdeDiccionario } from "@/db/repository/diccionario";
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

type EntradaTermino = {
  term?: string;
  pos?: string;
  gloss?: string;
  example?: string | null;
  translation?: string;
  level?: string;
};

type PostBody = EntradaTermino & { entradas?: EntradaTermino[] };

export async function POST(request: Request) {
  let body: PostBody | null;
  try {
    body = (await request.json()) as PostBody | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  // El camino del lote: una extracción marca cuarenta candidatas de una vez, y
  // cuarenta peticiones serían cuarenta viajes al servidor. El camino de una
  // sola entrada, que es el que usa la pantalla del diccionario, sigue intacto
  // debajo.
  if (Array.isArray(body?.entradas)) {
    const validas = body.entradas.filter(
      (e): e is Required<Pick<EntradaTermino, "term" | "pos" | "gloss" | "translation" | "level">> &
        EntradaTermino =>
        esString(e?.term) &&
        esString(e?.pos) &&
        esString(e?.gloss) &&
        esString(e?.translation) &&
        esString(e?.level) &&
        isCefrLevel(e.level as string),
    );

    if (validas.length === 0) {
      return NextResponse.json(
        { error: "Ninguna de las palabras enviadas está completa." },
        { status: 400 },
      );
    }

    const resultado = await anadirVariasDesdeDiccionario(
      getDb(),
      validas.map((e) => ({
        term: e.term as string,
        pos: e.pos as string,
        gloss: e.gloss as string,
        example: e.example ?? null,
        translation: e.translation as string,
        level: e.level as string,
      })),
    );
    return NextResponse.json(resultado);
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
    // Recortado, igual que se validó: `tipoDeTermino` compara `pos` con
    // "verb" tal cual, así que un "verb " con un espacio de más clasificaría
    // el término como expresión en vez de como verbo frasal.
    pos: pos.trim(),
    gloss: gloss.trim(),
    example: example?.trim() || null,
    translation: translation.trim(),
    level,
  });

  return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 });
}
