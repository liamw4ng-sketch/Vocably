import { NextResponse } from "next/server";
import { buscarEnDiccionario, buscarEnBiblioteca } from "@/db/repository/diccionario";
import { buscarSignificadosEspanoles, completarConTraductor } from "@/db/repository/espanol";
import { agruparPorCategoria } from "@/lib/diccionario/categoria";
import { MAXIMO_SIGNIFICADOS_MOSTRADOS } from "@/lib/diccionario/espanol";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";
import { getDb } from "@/db/client";

/**
 * Los cuatro escalones de la búsqueda: la biblioteca, la tabla del
 * diccionario, los significados en español del Wikcionario y, si esos tres
 * gratuitos no dieron nada, el traductor gratuito. **No llama a Claude
 * nunca**: lo único que cuesta dinero vive en /api/diccionario/afinar,
 * aparte y a propósito.
 */
export async function GET(request: Request) {
  const termino = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!termino) {
    return NextResponse.json({ error: "Escribe una palabra para buscar." }, { status: 400 });
  }

  const db = getDb();
  try {
    const [enBiblioteca, acepciones, encontrados] = await Promise.all([
      buscarEnBiblioteca(db, termino),
      buscarEnDiccionario(db, termino),
      buscarSignificadosEspanoles(db, termino),
    ]);

    // El escalón de pago: solo si los tres gratuitos no dieron español.
    const conEspanol = await completarConTraductor(
      db,
      termino,
      encontrados,
      crearTraductorMyMemory(),
    );

    // Una fila por palabra y categoría, así que cada grupo trae exactamente
    // una; se usa `agruparPorCategoria` por su orden, que es el mismo con el
    // que se enseñan las acepciones justo debajo.
    const significados = agruparPorCategoria(conEspanol).map((grupo) => ({
      pos: grupo.pos,
      nombre: grupo.nombre,
      meanings: grupo.acepciones
        .flatMap((fila) => fila.meanings)
        .slice(0, MAXIMO_SIGNIFICADOS_MOSTRADOS),
      source: grupo.acepciones[0].source,
    }));

    // La única forma fiable de saber si una acepción concreta ya está guardada:
    // dos entradas pueden compartir término ("bank" = orilla / banco) y solo la
    // pista en inglés (senseHint === gloss) distingue una de otra.
    const pistasGuardadas = new Set(enBiblioteca.map((t) => t.senseHint));
    return NextResponse.json({
      termino,
      enBiblioteca,
      significados,
      acepciones: acepciones.map((a) => ({ ...a, yaGuardada: pistasGuardadas.has(a.gloss) })),
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
