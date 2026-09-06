import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

const SECRET = "secreto-de-prueba";
const HOUR = 60 * 60 * 1000;

describe("sesión", () => {
  it("acepta un token recién creado", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    expect(verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rechaza un token caducado", () => {
    const token = createSessionToken(SECRET, Date.now() - 1);
    expect(verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rechaza un token firmado con otro secreto", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    expect(verifySessionToken(token, "otro-secreto")).toBe(false);
  });

  it("rechaza un token manipulado", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    const [expiry, signature] = token.split(".");
    const manipulado = `${Number(expiry) + HOUR}.${signature}`;
    expect(verifySessionToken(manipulado, SECRET)).toBe(false);
  });

  it("rechaza basura", () => {
    expect(verifySessionToken("", SECRET)).toBe(false);
    expect(verifySessionToken("no-es-un-token", SECRET)).toBe(false);
  });
});
