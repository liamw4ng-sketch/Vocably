import { describe, it, expect } from "vitest";
import { normalizeTerm } from "@/lib/normalize";

describe("normalizeTerm", () => {
  it("pasa a minúsculas", () => {
    expect(normalizeTerm("Come Across")).toBe("come across");
  });

  it("quita los espacios de los extremos", () => {
    expect(normalizeTerm("  give up  ")).toBe("give up");
  });

  it("colapsa los espacios interiores", () => {
    expect(normalizeTerm("look   forward   to")).toBe("look forward to");
  });

  it("trata el tabulador y el salto de línea como espacio", () => {
    expect(normalizeTerm("put\tup\nwith")).toBe("put up with");
  });

  it("es idempotente", () => {
    const once = normalizeTerm("  Take   OFF ");
    expect(normalizeTerm(once)).toBe(once);
  });

  it("conserva los acentos como caracteres compuestos iguales", () => {
    expect(normalizeTerm("café")).toBe(normalizeTerm("café"));
  });
});
