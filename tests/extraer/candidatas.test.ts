import { describe, it, expect } from "vitest";
import { candidatasDeTexto } from "@/lib/extraer/candidatas";

const textos = (frase: string) => candidatasDeTexto(frase).map((c) => c.texto);

describe("candidatasDeTexto", () => {
  it("saca las palabras sueltas en minúscula", () => {
    expect(textos("The Dog barked")).toEqual(
      expect.arrayContaining(["the", "dog", "barked"]),
    );
  });

  /**
   * Los grupos son lo que encuentra los verbos frasales. No se analiza la
   * gramática: se le pregunta al diccionario, que ya sabe cuáles existen.
   */
  it("saca grupos de dos y de tres palabras", () => {
    const salida = textos("She gave up quickly");
    expect(salida).toContain("gave up");
    expect(salida).toContain("gave up quickly");
    expect(salida).toContain("she gave up");
  });

  it("no saca grupos de cuatro", () => {
    for (const c of candidatasDeTexto("one two three four")) {
      expect(c.texto.split(" ").length).toBeLessThanOrEqual(3);
    }
  });

  /**
   * Un grupo que cruza el punto une palabras que nunca estuvieron juntas y
   * podría inventarse un verbo frasal que el texto no contiene.
   */
  it("los grupos no cruzan el final de una frase", () => {
    const salida = textos("He arrived. Then left.");
    expect(salida).toContain("he arrived");
    expect(salida).not.toContain("arrived then");
  });

  it("cada candidata trae la frase en que apareció", () => {
    const salida = candidatasDeTexto("The dog barked. The cat slept.");
    expect(salida.find((c) => c.texto === "cat")?.frase).toBe("The cat slept.");
    expect(salida.find((c) => c.texto === "dog")?.frase).toBe("The dog barked.");
  });

  it("una palabra repetida sale una vez, con la frase de la primera", () => {
    const salida = candidatasDeTexto("The dog barked. The dog slept.");
    const perros = salida.filter((c) => c.texto === "dog");
    expect(perros).toHaveLength(1);
    expect(perros[0].frase).toBe("The dog barked.");
  });

  it("conserva apóstrofos y guiones, que son parte de la palabra", () => {
    const salida = textos("It's a well-known problem");
    expect(salida).toContain("it's");
    expect(salida).toContain("well-known");
  });

  it("deja fuera los números y la puntuación suelta", () => {
    const salida = textos("He paid 42 dollars -- twice!");
    expect(salida).not.toContain("42");
    expect(salida).not.toContain("--");
    expect(salida).toContain("dollars");
  });

  it("con un texto vacío o sin letras devuelve lista vacía", () => {
    expect(candidatasDeTexto("")).toEqual([]);
    expect(candidatasDeTexto("   \n  ")).toEqual([]);
    expect(candidatasDeTexto("123 456 !!!")).toEqual([]);
  });
});
