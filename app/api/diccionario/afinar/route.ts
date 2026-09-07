import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { afinarTraduccion } from "@/lib/diccionario/afinar";
import { dictionaryEntries } from "@/db/schema";
import { getDb } from "@/db/client";

export const maxDuration = 60;

type Body = { entryId?: number };

/**
 * Aislada en su propia ruta a propósito: así se ve de un vistazo que ninguna
 * otra ruta del diccionario llama a la API de Claude.
 */
export async function POST(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }
  const { entryId } = body ?? {};
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ error: "Falta la acepción que afinar." }, { status: 400 });
  }

  const db = getDb();
  const [entrada] = await db
    .select()
    .from(dictionaryEntries)
    .where(eq(dictionaryEntries.id, entryId as number))
    .limit(1);

  if (!entrada) {
    return NextResponse.json({ error: "Esa acepción no existe." }, { status: 404 });
  }

  let afinada;
  try {
    afinada = await afinarTraduccion({ term: entrada.term, gloss: entrada.gloss });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo afinar la traducción: ${detalle}` }, { status: 502 });
  }

  await db
    .update(dictionaryEntries)
    .set({ translations: afinada.translations, translationSource: "claude" })
    .where(eq(dictionaryEntries.id, entrada.id));

  return NextResponse.json(afinada);
}
