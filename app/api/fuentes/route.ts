import { NextResponse } from "next/server";
import { renombrarFuente } from "@/db/repository/terms";
import { MAXIMO_NOMBRE_DE_FUENTE } from "@/lib/fuentes";
import { getDb } from "@/db/client";

type Body = { titulo?: unknown; nuevoTitulo?: unknown };

/**
 * Cambia el nombre de una fuente. Se identifica por su título actual, no por
 * un id, porque el mismo documento extraído dos veces son dos filas: para el
 * usuario es un documento y se renombra entero.
 */
export async function PATCH(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo de la petición no es JSON válido." },
      { status: 400 },
    );
  }

  const { titulo, nuevoTitulo } = body ?? {};
  if (typeof titulo !== "string" || typeof nuevoTitulo !== "string") {
    return NextResponse.json(
      { error: "Hacen falta el título actual y el nuevo." },
      { status: 400 },
    );
  }

  const nuevo = nuevoTitulo.trim();
  if (!nuevo) {
    return NextResponse.json(
      { error: "El nombre de la fuente no puede quedarse vacío." },
      { status: 400 },
    );
  }
  if (nuevo.length > MAXIMO_NOMBRE_DE_FUENTE) {
    return NextResponse.json(
      { error: `El nombre no puede pasar de ${MAXIMO_NOMBRE_DE_FUENTE} caracteres.` },
      { status: 400 },
    );
  }

  const renombradas = await renombrarFuente(getDb(), titulo, nuevo);
  if (renombradas === 0) {
    // 404 y no 200: si el título no existe, el cliente está mirando una lista
    // vieja y hay que decírselo en vez de dejarle creer que se ha renombrado.
    return NextResponse.json({ error: "Esa fuente ya no existe." }, { status: 404 });
  }

  return NextResponse.json({ titulo: nuevo, renombradas });
}
