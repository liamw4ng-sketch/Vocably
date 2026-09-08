import { NextResponse } from "next/server";
import {
  getAjustes,
  setNewCardsPerDay,
  setSessionSize,
  setSessionMode,
  type Ajustes,
} from "@/db/repository/settings";
import { TOPE_MAXIMO_TARJETAS_NUEVAS, MAXIMO_TAMANO_SESION, MODOS, esModo } from "@/lib/ajustes";
import { getDb } from "@/db/client";

type Body = Partial<Record<keyof Ajustes, unknown>>;

function esEnteroEnRango(valor: unknown, maximo: number): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= maximo;
}

export async function GET() {
  return NextResponse.json(await getAjustes(getDb()));
}

/**
 * Acepta uno de los tres ajustes o varios a la vez. Un cuerpo sin ningún campo
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

  const { newCardsPerDay, sessionSize, sessionMode } = body ?? {};

  if (newCardsPerDay === undefined && sessionSize === undefined && sessionMode === undefined) {
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

  if (sessionSize !== undefined && !esEnteroEnRango(sessionSize, MAXIMO_TAMANO_SESION)) {
    return NextResponse.json(
      { error: `El tamaño de la sesión debe ser un entero entre 0 y ${MAXIMO_TAMANO_SESION}.` },
      { status: 400 },
    );
  }

  if (sessionMode !== undefined && !esModo(sessionMode)) {
    return NextResponse.json(
      { error: `El modo de sesión debe ser uno de: ${MODOS.join(", ")}.` },
      { status: 400 },
    );
  }

  const db = getDb();
  if (newCardsPerDay !== undefined) await setNewCardsPerDay(db, newCardsPerDay);
  if (sessionSize !== undefined) await setSessionSize(db, sessionSize);
  if (sessionMode !== undefined) await setSessionMode(db, sessionMode);

  return NextResponse.json(await getAjustes(db));
}
