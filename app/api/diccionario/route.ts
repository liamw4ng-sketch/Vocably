import { NextResponse } from "next/server";
import { buscarEnDiccionario, buscarEnBiblioteca, traducirSiFalta } from "@/db/repository/diccionario";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";
import { getDb } from "@/db/client";

/**
 * Los escalones 1, 2 y 3 de la búsqueda: la biblioteca, la tabla del
 * diccionario y, si falta el español, el traductor gratuito. **No llama a
 * Claude nunca**: lo único que cuesta dinero vive en /api/diccionario/afinar,
 * aparte y a propósito.
 */
export async function GET(request: Request) {
  const termino = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!termino) {
    return NextResponse.json({ error: "Escribe una palabra para buscar." }, { status: 400 });
  }

  const db = getDb();
  try {
    const [enBiblioteca, acepciones] = await Promise.all([
      buscarEnBiblioteca(db, termino),
      buscarEnDiccionario(db, termino),
    ]);

    const conEspanol = await traducirSiFalta(db, acepciones, crearTraductorMyMemory());

    // La única forma fiable de saber si una acepción concreta ya está guardada:
    // dos entradas pueden compartir término ("bank" = orilla / banco) y solo la
    // pista en inglés (senseHint === gloss) distingue una de otra.
    const pistasGuardadas = new Set(enBiblioteca.map((t) => t.senseHint));
    return NextResponse.json({
      termino,
      enBiblioteca,
      acepciones: conEspanol.map((a) => ({ ...a, yaGuardada: pistasGuardadas.has(a.gloss) })),
    });
  } catch (error) {
    // Sin este catch, Next devuelve un 500 con cuerpo HTML; el navegador
    // revienta al leerlo como JSON y el usuario acaba viendo un mensaje interno
    // del navegador. El caso más probable, con diferencia, es que falten las
    // migraciones o la carga del diccionario, así que se dice.
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      {
        error:
          `No se pudo buscar en el diccionario: ${detalle}. ` +
          "Si es la primera vez que lo usas, comprueba que has aplicado las migraciones " +
          "y cargado el diccionario.",
      },
      { status: 500 },
    );
  }
}
