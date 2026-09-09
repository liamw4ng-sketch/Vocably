import { describe, it, expect } from "vitest";
import {
  traduccionParaGuardar,
  sinEspanolEnNingunOrigen,
} from "@/lib/diccionario/traduccion";

/**
 * La escalera del español, que comparten las dos puertas de entrada a la
 * biblioteca: la pantalla del diccionario, palabra a palabra, y la de extraer
 * sin IA, cuarenta de golpe. Estas pruebas estaban en
 * `tests/buscador-diccionario.test.ts` y se mudaron con las funciones.
 */

describe("traduccionParaGuardar", () => {
  it("lo escrito a mano manda sobre todo", () => {
    expect(traduccionParaGuardar("  mi versión ", ["de la acepción"], ["de la palabra"])).toBe("mi versión");
  });

  /**
   * El de la acepción es más preciso que el de la palabra: viene del volcado
   * inglés o de afinar con IA, que responden por esa acepción concreta.
   */
  it("sin nada escrito, manda el de la acepción sobre el de la palabra", () => {
    expect(traduccionParaGuardar("", ["orilla"], ["banco", "reserva"])).toBe("orilla");
  });

  it("y si la acepción no tiene, sirve el de la palabra: solo el primero", () => {
    expect(traduccionParaGuardar("", [], ["banco", "reserva"])).toBe("banco");
  });

  it("sin ninguno de los tres, cadena vacía", () => {
    expect(traduccionParaGuardar("   ", [], [])).toBe("");
  });

  /**
   * El español de la palabra son definiciones enteras del Wikcionario, no
   * equivalentes cortos, y hasta cinco seguidas —con su punto final y sus
   * comas internas— no se pueden estudiar en el reverso de una tarjeta. Esta
   * prueba falla si alguien vuelve a unirlas con `.join(", ")`, que es
   * justo el fallo que se arregla aquí: para `language` el reverso quedaba
   * "Idioma., Lengua, lenguaje., Léxico, jerga, vocabulario., …".
   */
  it("nunca junta varias definiciones de la palabra en una sola traducción", () => {
    const definicionesDeLanguage = [
      "Idioma.",
      "Lengua, lenguaje.",
      "Léxico, jerga, vocabulario.",
      "Redacción, texto (de un pasaje específico).",
      "Grosería, lenguaje soez.",
    ];

    const guardado = traduccionParaGuardar("", [], definicionesDeLanguage);

    expect(guardado).toBe("Idioma.");
    expect(guardado).not.toBe(definicionesDeLanguage.join(", "));
  });
});

/**
 * El aviso que faltaba (hallazgo A): sin esto, una acepción sin español de
 * ningún origen enseña el término, un desplegable cerrado, el botón «Añadir»
 * deshabilitado y ninguna explicación de por qué.
 */
describe("sinEspanolEnNingunOrigen", () => {
  it("sin nada en ningún origen, avisa", () => {
    expect(sinEspanolEnNingunOrigen([], [])).toBe(true);
  });

  it("con español de la acepción, no avisa", () => {
    expect(sinEspanolEnNingunOrigen(["orilla"], [])).toBe(false);
  });

  it("con español de la palabra, no avisa", () => {
    expect(sinEspanolEnNingunOrigen([], ["banco"])).toBe(false);
  });

  /**
   * Diferido de la revisión de `extraer-sin-ia`: mirar solo la longitud de las
   * listas daba por buena una que trae la cadena vacía dentro, y eso es un
   * reverso en blanco igual. Se pregunta por lo que se guardaría, no por
   * cuántos elementos hay.
   */
  it("una lista con la cadena vacía dentro no es español", () => {
    expect(sinEspanolEnNingunOrigen([""], [""])).toBe(true);
  });
});
