import { NextResponse } from "next/server";
import { buscarEnDiccionario, buscarEnBiblioteca } from "@/db/repository/diccionario";
import { getDb } from "@/db/client";

/**
 * Los escalones 1 y 2 de la búsqueda. **No llama a Claude nunca**: lo único que
 * cuesta dinero vive en /api/diccionario/afinar, aparte y a propósito.
 */
export async function GET(request: Request) {
  const termino = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!termino) {
    return NextResponse.json({ error: "Escribe una palabra para buscar." }, { status: 400 });
  }

  const db = getDb();
  const [enBiblioteca, acepciones] = await Promise.all([
    buscarEnBiblioteca(db, termino),
    buscarEnDiccionario(db, termino),
  ]);

  // La única forma fiable de saber si una acepción concreta ya está guardada:
  // dos entradas pueden compartir término ("bank" = orilla / banco) y solo la
  // pista en inglés (senseHint === gloss) distingue una de otra.
  const pistasGuardadas = new Set(enBiblioteca.map((t) => t.senseHint));
  return NextResponse.json({
    termino,
    enBiblioteca,
    acepciones: acepciones.map((a) => ({ ...a, yaGuardada: pistasGuardadas.has(a.gloss) })),
  });
}
