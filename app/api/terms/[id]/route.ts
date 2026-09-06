import { NextResponse } from "next/server";
import { updateTerm, deleteTerm } from "@/db/repository/terms";
import { getDb } from "@/db/client";
import { isCefrLevel, extractedTermSchema } from "@/lib/extraction-schema";

type Context = { params: Promise<{ id: string }> };

type Fields = {
  term?: string;
  translation?: string;
  type?: string;
  level?: string;
};

/** Lo único que se puede editar. Cualquier otra clave del cuerpo se ignora. */
const TEXT_FIELDS = ["term", "translation"] as const;

const FIELD_LABELS: Record<(typeof TEXT_FIELDS)[number], string> = {
  term: "El término",
  translation: "La traducción",
};

/** Postgres SQLSTATE para "unique_violation". */
const UNIQUE_VIOLATION_CODE = "23505";

function hasUniqueViolationCode(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

/**
 * Drizzle envuelve el error real del driver en un `DrizzleQueryError` cuya
 * causa (`.cause`) es el error de postgres con el código SQLSTATE, así que
 * hay que mirar ambos niveles.
 */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return hasUniqueViolationCode(cause);
}

/** Convierte el segmento de ruta en un id numérico válido, o null si no lo es. */
function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  return Number(id);
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Identificador no válido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo de la petición no es JSON válido." },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "El cuerpo de la petición no es válido." }, { status: 400 });
  }

  // Lista blanca: se copian solo los cuatro campos editables, así que ninguna
  // otra clave del cuerpo (termNormalized, id, createdAt…) llega al UPDATE.
  const received = body as Record<string, unknown>;
  const fields: Fields = {};

  for (const name of TEXT_FIELDS) {
    if (received[name] === undefined) continue;
    const value = received[name];
    if (typeof value !== "string" || value.trim() === "") {
      return NextResponse.json(
        { error: `${FIELD_LABELS[name]} no puede quedar vacío.` },
        { status: 400 },
      );
    }
    fields[name] = value.trim();
  }

  if (received.type !== undefined) {
    if (!extractedTermSchema.shape.type.safeParse(received.type).success) {
      return NextResponse.json({ error: "Tipo de término no válido." }, { status: 400 });
    }
    fields.type = received.type as string;
  }
  if (received.level !== undefined) {
    if (typeof received.level !== "string" || !isCefrLevel(received.level)) {
      return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
    }
    fields.level = received.level;
  }

  try {
    await updateTerm(getDb(), numericId, fields);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Ya existe otro término igual en la biblioteca." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Identificador no válido." }, { status: 400 });
  }

  await deleteTerm(getDb(), numericId);
  return NextResponse.json({ ok: true });
}
