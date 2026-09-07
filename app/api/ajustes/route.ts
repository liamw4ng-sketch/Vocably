import { NextResponse } from "next/server";
import {
  getNewCardsPerDay,
  setNewCardsPerDay,
  TOPE_MAXIMO_TARJETAS_NUEVAS as TOPE_MAXIMO,
} from "@/db/repository/settings";
import { getDb } from "@/db/client";

type Body = { newCardsPerDay?: number };

export async function GET() {
  const newCardsPerDay = await getNewCardsPerDay(getDb());
  return NextResponse.json({ newCardsPerDay });
}

export async function PATCH(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { newCardsPerDay } = body ?? {};

  if (
    typeof newCardsPerDay !== "number" ||
    !Number.isInteger(newCardsPerDay) ||
    newCardsPerDay < 0 ||
    newCardsPerDay > TOPE_MAXIMO
  ) {
    return NextResponse.json(
      { error: `El tope de tarjetas nuevas debe ser un entero entre 0 y ${TOPE_MAXIMO}.` },
      { status: 400 },
    );
  }

  await setNewCardsPerDay(getDb(), newCardsPerDay);
  return NextResponse.json({ newCardsPerDay });
}
