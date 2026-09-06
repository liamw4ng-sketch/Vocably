import { NextResponse } from "next/server";
import { applyAnswer } from "@/db/repository/review";
import { getDb } from "@/db/client";

type Body = { answerId?: string; termId?: number; rating?: number };

export async function POST(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { answerId, termId, rating } = body ?? {};

  if (typeof answerId !== "string" || answerId.trim() === "") {
    return NextResponse.json({ error: "Falta el identificador de la respuesta." }, { status: 400 });
  }
  if (typeof termId !== "number" || !Number.isInteger(termId) || termId < 1) {
    return NextResponse.json({ error: "Término no válido." }, { status: 400 });
  }
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
    return NextResponse.json({ error: "Valoración no válida." }, { status: 400 });
  }

  try {
    const resultado = await applyAnswer(getDb(), {
      answerId,
      termId,
      rating,
      now: new Date(),
    });
    return NextResponse.json(resultado);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No se pudo registrar la respuesta: ${detalle}` },
      { status: 500 },
    );
  }
}
