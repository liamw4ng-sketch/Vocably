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

  it("normaliza NFD y NFC de un mismo término a la misma clave", () => {
    // Escapes explícitos (\uXXXX) para que ningún editor o herramienta pueda
    // renormalizar en silencio los literales de este fichero.
    // NFD: "cafe" + acento agudo combinante U+0301 (forma descompuesta, 5 code units).
    const nfd = "cafe\u0301";
    // NFC: "e" acentuada precompuesta U+00E9 (forma compuesta, 4 code units).
    const nfc = "caf\u00e9";

    // Comprueba que las dos formas son secuencias de code units distintas
    // antes de normalizar: si esto fallara, la comparación de abajo no
    // demostraría nada (la prueba sería tautológica).
    expect(nfd).not.toBe(nfc);
    expect(nfd.length).not.toBe(nfc.length);

    expect(normalizeTerm(nfd)).toBe(normalizeTerm(nfc));
  });
});
