import { NextResponse } from "next/server";
import { listTerms } from "@/db/repository/terms";
import {
  anadirDesdeDiccionario,
  anadirVariasDesdeDiccionario,
  type FuenteDeExtraccion,
} from "@/db/repository/diccionario";
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
  /** La frase del libro donde salió la palabra, cuando hay libro detrás. */
  context?: string | null;
};

type PostBody = EntradaTermino & {
  entradas?: unknown;
  fuente?: unknown;
};

/** Una entrada ya validada y recortada, lista para la base. */
type EntradaLimpia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translation: string;
  level: string;
  context?: string;
};

/**
 * Valida y recorta una entrada. **La comparten los dos caminos de esta ruta**,
 * el de una palabra y el del lote, porque son la misma tarjeta: tenerla escrita
 * solo en el primero dejaba pasar por el segundo una `translation: ""`, que es
 * una tarjeta de repaso con el reverso en blanco —lo que no se puede estudiar y
 * solo se descubre días después, en mitad de una sesión—. La garantía no puede
 * vivir únicamente en la pantalla.
 *
 * Recorta además de validar. `pos` sobre todo: `tipoDeTermino` compara con
 * "verb" tal cual, así que un "verb " con un espacio de más clasificaría un
 * verbo frasal como expresión, que es otro filtro y otra etiqueta en la ficha.
 *
 * Devuelve el motivo en vez de un simple `null` para que el camino de una
 * palabra pueda decir cuál falta; el del lote descarta la entrada y sigue.
 */
function entradaLimpia(
  cruda: EntradaTermino | null | undefined,
): { ok: true; entrada: EntradaLimpia } | { ok: false; error: string } {
  const e: EntradaTermino = cruda ?? {};

  if (
    !esString(e.term) ||
    !e.term.trim() ||
    !esString(e.pos) ||
    !e.pos.trim() ||
    !esString(e.gloss) ||
    !e.gloss.trim()
  ) {
    return { ok: false, error: "Falta el término, su categoría o su significado." };
  }
  if (!esString(e.translation) || !e.translation.trim()) {
    return { ok: false, error: "Falta la traducción." };
  }
  if (e.example !== undefined && e.example !== null && !esString(e.example)) {
    return { ok: false, error: "El ejemplo debe ser una cadena." };
  }
  if (e.context !== undefined && e.context !== null && !esString(e.context)) {
    return { ok: false, error: "La frase de contexto debe ser una cadena." };
  }
  // Sin nivel no se guarda: es la decisión del usuario, y un valor por defecto
  // llenaría la biblioteca de niveles que nadie ha elegido.
  if (!e.level || !isCefrLevel(e.level)) {
    return { ok: false, error: "Elige un nivel del MCER." };
  }

  return {
    ok: true,
    entrada: {
      term: e.term.trim(),
      pos: e.pos.trim(),
      gloss: e.gloss.trim(),
      example: e.example?.trim() || null,
      translation: e.translation.trim(),
      level: e.level,
      context: e.context?.trim() || undefined,
    },
  };
}

/**
 * La fuente de una extracción sin IA: el título y el rango de páginas que
 * eligió el usuario. Es opcional —la pantalla del diccionario no manda
 * ninguna—, pero si llega mal formada se rechaza en vez de guardar el lote
 * torcido bajo la fuente equivocada.
 */
function fuenteLimpia(
  cruda: unknown,
): { ok: true; fuente: FuenteDeExtraccion | undefined } | { ok: false; error: string } {
  if (cruda === undefined || cruda === null) return { ok: true, fuente: undefined };
  if (typeof cruda !== "object") return { ok: false, error: "La fuente no es válida." };

  const f = cruda as { title?: unknown; pageStart?: unknown; pageEnd?: unknown; level?: unknown };
  if (!esString(f.title) || !f.title.trim()) {
    return { ok: false, error: "Falta el título de la fuente." };
  }
  if (
    !Number.isInteger(f.pageStart) ||
    !Number.isInteger(f.pageEnd) ||
    (f.pageStart as number) < 1 ||
    (f.pageEnd as number) < (f.pageStart as number)
  ) {
    return { ok: false, error: "Rango de páginas no válido." };
  }
  if (!esString(f.level) || !isCefrLevel(f.level)) {
    return { ok: false, error: "Nivel del MCER no válido." };
  }

  return {
    ok: true,
    fuente: {
      title: f.title.trim(),
      pageStart: f.pageStart as number,
      pageEnd: f.pageEnd as number,
      level: f.level,
    },
  };
}

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
  // debajo. Los dos validan con `entradaLimpia`: es la misma tarjeta.
  if (Array.isArray(body?.entradas)) {
    const fuente = fuenteLimpia(body.fuente);
    if (!fuente.ok) return NextResponse.json({ error: fuente.error }, { status: 400 });

    const validas = body.entradas
      .map((e) => entradaLimpia(e as EntradaTermino))
      .filter((v): v is { ok: true; entrada: EntradaLimpia } => v.ok)
      .map((v) => v.entrada);

    if (validas.length === 0) {
      return NextResponse.json(
        { error: "Ninguna de las palabras enviadas está completa." },
        { status: 400 },
      );
    }

    const resultado = await anadirVariasDesdeDiccionario(getDb(), validas, fuente.fuente);
    return NextResponse.json(resultado);
  }

  const validada = entradaLimpia(body);
  if (!validada.ok) return NextResponse.json({ error: validada.error }, { status: 400 });

  const resultado = await anadirDesdeDiccionario(getDb(), validada.entrada);

  return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 });
}
