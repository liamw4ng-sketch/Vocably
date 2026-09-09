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

  /**
   * Un punto de decimal no es fin de frase: no va seguido de espacio ni de
   * fin de texto. Si se trocea ahí, "today" queda con un fragmento ("99
   * today.") que nunca existió como oración.
   */
  it("un punto de un número decimal no termina la frase", () => {
    const salida = candidatasDeTexto("The exam costs 19.99 today.");
    const hoy = salida.find((c) => c.texto === "today");
    expect(hoy?.frase).toBe("The exam costs 19.99 today.");
  });

  /**
   * Una abreviatura corriente de la lista acotada (Mr, Mrs, Ms, Dr, Prof,
   * St, vs, etc, e.g, i.e) tampoco termina la frase. Fuera de esa lista,
   * cualquier otra abreviatura seguirá partiendo la frase en dos.
   */
  it("una abreviatura corriente de la lista (Dr.) no termina la frase", () => {
    const salida = candidatasDeTexto("Dr. Smith arrived early.");
    const frases = new Set(salida.map((c) => c.frase));
    expect(frases.size).toBe(1);
    expect([...frases][0]).toBe("Dr. Smith arrived early.");
  });

  it("conserva apóstrofos y guiones, que son parte de la palabra", () => {
    const salida = textos("It's a well-known problem");
    expect(salida).toContain("it's");
    expect(salida).toContain("well-known");
  });

  /**
   * Los libros tipografiados casi siempre usan la comilla curva (’, U+2019)
   * en vez de la recta (', U+0027) para contracciones y posesivos. Si el
   * regex solo acepta la recta, "It's" se rompe en "it" y "s" sueltos.
   */
  it("conserva también el apóstrofo curvo de las contracciones", () => {
    const salida = textos("It’s a well-known problem");
    expect(salida).toContain("it’s");
    expect(salida).not.toContain("it");
    expect(salida).not.toContain("s");
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
