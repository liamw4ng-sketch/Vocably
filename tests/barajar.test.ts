import { describe, it, expect } from "vitest";
import { barajar } from "@/lib/barajar";

/** Generador determinista: recorre la secuencia dada y vuelve a empezar. */
function secuencia(valores: number[]): () => number {
  let i = 0;
  return () => valores[i++ % valores.length];
}

describe("barajar", () => {
  it("no toca el array original", () => {
    const original = [1, 2, 3, 4, 5];
    barajar(original, secuencia([0.1, 0.9, 0.5, 0.3]));
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it("devuelve exactamente los mismos elementos", () => {
    const resultado = barajar([1, 2, 3, 4, 5], secuencia([0.1, 0.9, 0.5, 0.3]));
    expect([...resultado].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("con el mismo generador da siempre el mismo orden", () => {
    const a = barajar([1, 2, 3, 4, 5], secuencia([0.1, 0.9, 0.5, 0.3]));
    const b = barajar([1, 2, 3, 4, 5], secuencia([0.1, 0.9, 0.5, 0.3]));
    expect(a).toEqual(b);
  });

  it("con generadores distintos da órdenes distintos", () => {
    const a = barajar([1, 2, 3, 4, 5], secuencia([0]));
    const b = barajar([1, 2, 3, 4, 5], secuencia([0.99]));
    expect(a).not.toEqual(b);
  });

  it("un generador que devuelve 1 no rompe el array", () => {
    const resultado = barajar([1, 2, 3], secuencia([1]));
    expect([...resultado].sort()).toEqual([1, 2, 3]);
    expect(resultado).not.toContain(undefined);
  });

  it("con suficientes tiradas, cualquier elemento puede quedar el primero", () => {
    // Sin esto, un sorteo sesgado que siempre devolviera el mismo subconjunto
    // pasaría todas las pruebas de arriba.
    const primeros = new Set<number>();
    for (let semilla = 0; semilla < 200; semilla++) {
      let x = semilla + 1;
      const pseudoaleatorio = () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
      };
      primeros.add(barajar([1, 2, 3, 4, 5], pseudoaleatorio)[0]);
    }
    expect([...primeros].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("un array vacío o de un elemento no rompe", () => {
    expect(barajar([])).toEqual([]);
    expect(barajar([7])).toEqual([7]);
  });
});
