import { NextResponse } from "next/server";
import { getDueQueue } from "@/db/repository/review";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Se devuelve la cola entera: `cartas` y `repasosFuera`, que la pantalla
  // necesita para decir cuántos repasos quedaron fuera del límite.
  const cola = await getDueQueue(getDb(), {
    now: new Date(),
    source: url.searchParams.get("source") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
  });
  return NextResponse.json(cola);
}
