import { NextResponse } from "next/server";
import { listTerms } from "@/db/repository/terms";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await listTerms(getDb(), {
    level: url.searchParams.get("level") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  return NextResponse.json({ terms: rows });
}
