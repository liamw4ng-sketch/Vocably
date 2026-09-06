import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };

  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  const token = createSessionToken(
    process.env.SESSION_SECRET as string,
    Date.now() + SESSION_DURATION_MS,
  );

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
  return response;
}
