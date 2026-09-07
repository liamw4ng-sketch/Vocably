import { NextResponse } from "next/server";
import {
  getAjustes,
  setNewCardsPerDay,
  setReviewsPerSession,
  type Ajustes,
} from "@/db/repository/settings";
import {
  TOPE_MAXIMO_TARJETAS_NUEVAS,
  MAXIMO_REPASOS_POR_SESION,
} from "@/lib/ajustes";
import { getDb } from "@/db/client";

type Body = Partial<Record<keyof Ajustes, unknown>>;

function esEnteroEnRango(valor: unknown, maximo: number): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= maximo;
}

export async function GET() {
  return NextResponse.json(await getAjustes(getDb()));
}

/**
 * Acepta uno de los dos ajustes o los dos. Un cuerpo sin ningún campo
 * conocido se rechaza con 400 en vez de responder 200 sin guardar nada: si el
 * cliente se equivoca de nombre, el usuario tiene que enterarse.
 */
export async function PATCH(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { newCardsPerDay, reviewsPerSession } = body ?? {};

  if (newCardsPerDay === undefined && reviewsPerSession === undefined) {
    return NextResponse.json(
      { error: "La petición no trae ningún ajuste que cambiar." },
      { status: 400 },
    );
  }

  if (newCardsPerDay !== undefined && !esEnteroEnRango(newCardsPerDay, TOPE_MAXIMO_TARJETAS_NUEVAS)) {
    return NextResponse.json(
      {
        error: `El tope de tarjetas nuevas debe ser un entero entre 0 y ${TOPE_MAXIMO_TARJETAS_NUEVAS}.`,
      },
      { status: 400 },
    );
  }

  if (reviewsPerSession !== undefined && !esEnteroEnRango(reviewsPerSession, MAXIMO_REPASOS_POR_SESION)) {
    return NextResponse.json(
      {
        error: `Los repasos por sesión deben ser un entero entre 0 y ${MAXIMO_REPASOS_POR_SESION}.`,
      },
      { status: 400 },
    );
  }

  const db = getDb();
  if (newCardsPerDay !== undefined) await setNewCardsPerDay(db, newCardsPerDay);
  if (reviewsPerSession !== undefined) await setReviewsPerSession(db, reviewsPerSession);

  return NextResponse.json(await getAjustes(db));
}
