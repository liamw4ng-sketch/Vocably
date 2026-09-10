import { NextResponse } from "next/server";
import { buscarSugerencias } from "@/db/repository/extraer";
import { esNivel } from "@/lib/nivel/mcer";
import type { Candidata } from "@/lib/extraer/candidatas";
import { getDb } from "@/db/client";

/**
 * Las candidatas de un texto que merece la pena ofrecer.
 *
 * **No llama a Claude ni a ningún servicio de pago**, y tampoco al traductor
 * gratuito: traducir cientos de candidatas se comería su cuota diaria en una
 * sola extracción. Todo lo que devuelve sale de la base.
 *
 * El PDF **no llega hasta aquí**: lo lee el navegador y manda solo las cadenas
 * candidatas con su frase, que para cinco páginas son unos 40 KB.
 */
export async function POST(request: Request) {
  let body: { candidatas?: unknown; suelo?: unknown } | null;
  try {
    body = (await request.json()) as { candidatas?: unknown; suelo?: unknown } | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const suelo = body?.suelo;
  if (!esNivel(suelo)) {
    return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
  }

  // Una candidata mal formada se descarta; no puede tumbar la extracción entera.
  const candidatas: Candidata[] = (Array.isArray(body?.candidatas) ? body.candidatas : []).filter(
    (c): c is Candidata =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Candidata).texto === "string" &&
      typeof (c as Candidata).frase === "string",
  );

  if (candidatas.length === 0) {
    return NextResponse.json({ error: "No se ha encontrado texto que analizar." }, { status: 400 });
  }

  try {
    const sugerencias = await buscarSugerencias(getDb(), candidatas, suelo);
    return NextResponse.json({ sugerencias });
  } catch (error) {
    // Sin este catch, Next devuelve un 500 con cuerpo HTML; el navegador
    // revienta al leerlo como JSON y el usuario acaba viendo un mensaje interno
    // del navegador. La causa más probable es que falten los niveles.
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      {
        error:
          `No se pudo analizar el texto: ${detalle}. ` +
          "Si es la primera vez que extraes sin IA, comprueba que has aplicado las " +
          "migraciones y cargado los niveles del MCER.",
      },
      { status: 500 },
    );
  }
}
