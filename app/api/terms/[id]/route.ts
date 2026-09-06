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

  const fields = (await request.json()) as Fields;

  if (fields.type !== undefined && !extractedTermSchema.shape.type.safeParse(fields.type).success) {
    return NextResponse.json({ error: "Tipo de término no válido." }, { status: 400 });
  }
  if (fields.level !== undefined && !isCefrLevel(fields.level)) {
    return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
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
