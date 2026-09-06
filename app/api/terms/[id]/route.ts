import { NextResponse } from "next/server";
import { updateTerm, deleteTerm } from "@/db/repository/terms";
import { getDb } from "@/db/client";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const fields = (await request.json()) as {
    term?: string;
    translation?: string;
    type?: string;
    level?: string;
  };
  await updateTerm(getDb(), Number(id), fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  await deleteTerm(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
