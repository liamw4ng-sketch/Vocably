import { describe, it, expect } from "vitest";
import { variantesDelLema } from "@/lib/diccionario/lema";

describe("variantesDelLema", () => {
  it("busca primero lo que se escribió", () => {
    expect(variantesDelLema("Come Across")[0]).toBe("come across");
  });

  it("encuentra el idiom que Wikcionario guarda con 'one'", () => {
    expect(variantesDelLema("bite off more than you can chew")).toContain(
      "bite off more than one can chew",
    );
  });

  it("funciona también al revés: de 'one' a 'you'", () => {
    expect(variantesDelLema("bite off more than one can chew")).toContain(
      "bite off more than you can chew",
    );
  });

  it("cambia los posesivos y los reflexivos", () => {
    expect(variantesDelLema("hold your horses")).toContain("hold one's horses");
    expect(variantesDelLema("make oneself at home")).toContain("make yourself at home");
  });

  it("intercambia someone y somebody", () => {
    expect(variantesDelLema("give someone a hand")).toContain("give somebody a hand");
  });

  it("intercambia someone's y somebody's en forma posesiva", () => {
    expect(variantesDelLema("spring to someone's defence")).toContain(
      "spring to somebody's defence",
    );
  });

  it("funciona también al revés: de somebody's a someone's", () => {
    expect(variantesDelLema("spring to somebody's defence")).toContain(
      "spring to someone's defence",
    );
  });

  it("solo cambia palabras enteras", () => {
    // "young" contiene "you" pero no es "you".
    expect(variantesDelLema("young at heart")).toEqual(["young at heart"]);
  });

  it("no repite la forma escrita cuando no hay nada que cambiar", () => {
    expect(variantesDelLema("thorough")).toEqual(["thorough"]);
  });
});
