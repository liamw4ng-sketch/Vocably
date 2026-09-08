import { NextResponse } from "next/server";
import { contarColecciones } from "@/db/repository/review";
import { getDb } from "@/db/client";

/** Los contadores de la pantalla previa del repaso. No construye la cola. */
export async function GET() {
  return NextResponse.json(await contarColecciones(getDb(), new Date()));
}
