import { describe, it, expect } from "vitest";
import { errorDeNombreDeFuente, MAXIMO_NOMBRE_DE_FUENTE } from "@/lib/fuentes";

describe("errorDeNombreDeFuente", () => {
  it("un nombre normal vale", () => {
    expect(errorDeNombreDeFuente("fake", "fake_news.pdf")).toBe("");
  });

  /** Sin nombre, la fuente desaparece del filtro y sus palabras con ella. */
  it("vacío o solo espacios, no", () => {
    expect(errorDeNombreDeFuente("", "fake_news.pdf")).toMatch(/vacío/i);
    expect(errorDeNombreDeFuente("   ", "fake_news.pdf")).toMatch(/vacío/i);
  });

  /** Un pegado accidental dejaría un botón de filtro que no cabe en el móvil. */
  it("demasiado largo, tampoco", () => {
    expect(errorDeNombreDeFuente("x".repeat(MAXIMO_NOMBRE_DE_FUENTE), "a")).toBe("");
    expect(errorDeNombreDeFuente("x".repeat(MAXIMO_NOMBRE_DE_FUENTE + 1), "a")).toMatch(
      /caracteres/i,
    );
  });

  /** Se compara con los espacios ya recortados: "fake " no es un nombre nuevo. */
  it("el mismo nombre que ya tenía no es un cambio", () => {
    expect(errorDeNombreDeFuente("fake", "fake")).toMatch(/ya es su nombre/i);
    expect(errorDeNombreDeFuente("  fake  ", "fake")).toMatch(/ya es su nombre/i);
  });
});
