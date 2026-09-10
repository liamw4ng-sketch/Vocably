import { describe, it, expect } from "vitest";
import { traduccionesPosibles } from "@/lib/diccionario/traducciones-posibles";

describe("traduccionesPosibles", () => {
  /**
   * Los equivalentes cortos de una acepción hacen mejor reverso de tarjeta que
   * una definición entera del Wikcionario español, así que van delante.
   */
  it("pone primero las de las acepciones y después las de la palabra", () => {
    expect(traduccionesPosibles([["orilla"], ["banco"]], [["Banco.", "Reserva."]])).toEqual([
      "orilla",
      "banco",
      "Banco.",
      "Reserva.",
    ]);
  });

  it("junta varias acepciones y varios grupos en una sola lista", () => {
    expect(
      traduccionesPosibles([["a", "b"], ["c"]], [["d"], ["e", "f"]]),
    ).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  /**
   * Sin esto la lista ofrecería "Banco." y "banco" como si fueran dos opciones
   * distintas, y el usuario tendría que elegir entre dos cosas iguales.
   */
  it("quita repetidos sin distinguir mayúsculas ni espacios de sobra", () => {
    expect(traduccionesPosibles([["banco"], ["  BANCO  "]], [["Banco"]])).toEqual(["banco"]);
  });

  /** Se enseña y se guarda la forma que venía, no la normalizada. */
  it("conserva la primera forma que apareció", () => {
    expect(traduccionesPosibles([["Orilla"]], [["orilla"]])).toEqual(["Orilla"]);
  });

  it("descarta las vacías y las que solo traen espacios", () => {
    expect(traduccionesPosibles([["", "  ", "banco"]], [[""]])).toEqual(["banco"]);
  });

  it("sin ninguna traducción devuelve lista vacía", () => {
    expect(traduccionesPosibles([], [])).toEqual([]);
    expect(traduccionesPosibles([[], []], [[]])).toEqual([]);
  });
});
