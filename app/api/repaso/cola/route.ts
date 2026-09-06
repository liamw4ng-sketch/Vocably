import { NextResponse } from "next/server";
import { getDueQueue } from "@/db/repository/review";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cartas = await getDueQueue(getDb(), {
    now: new Date(),
    source: url.searchParams.get("source") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    adelantar: url.searchParams.get("adelantar") === "1",
  });
  return NextResponse.json({ cartas });
}
