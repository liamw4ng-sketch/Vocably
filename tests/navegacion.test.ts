import { describe, it, expect } from "vitest";
import { DESTINOS, muestraBarra, esRutaActiva } from "@/lib/navegacion";

describe("DESTINOS", () => {
  it("son las cuatro pantallas, con el repaso primero", () => {
    expect(DESTINOS.map((d) => d.href)).toEqual([
      "/repaso",
      "/biblioteca",
      "/diccionario",
      "/extraer",
    ]);
  });

  it("cada una trae su etiqueta en español", () => {
    expect(DESTINOS.map((d) => d.etiqueta)).toEqual([
      "Repaso",
      "Biblioteca",
      "Diccionario",
      "Extraer",
    ]);
  });
});

describe("muestraBarra", () => {
  /**
   * En la pantalla de acceso no hay adónde ir: enseñar la barra sería ofrecer
   * cuatro enlaces que el proxy va a rebotar a esta misma pantalla.
   */
  it("no sale en la pantalla de acceso", () => {
    expect(muestraBarra("/login")).toBe(false);
  });

  it("sale en las cuatro pantallas de la aplicación", () => {
    for (const destino of DESTINOS) {
      expect(muestraBarra(destino.href)).toBe(true);
    }
  });

  /**
   * `/` redirige a otra pantalla, así que el usuario nunca se queda ahí. Pero
   * durante ese instante la barra no debe parpadear.
   */
  it("no sale en la raíz, que solo redirige", () => {
    expect(muestraBarra("/")).toBe(false);
  });
});

describe("esRutaActiva", () => {
  it("marca la pantalla en la que estás", () => {
    expect(esRutaActiva("/repaso", "/repaso")).toBe(true);
  });

  it("no marca las demás", () => {
    expect(esRutaActiva("/repaso", "/biblioteca")).toBe(false);
  });

  /**
   * Next entrega el camino sin barra final, pero una barra de más no puede
   * dejar la navegación sin ninguna pestaña marcada.
   */
  it("aguanta una barra final", () => {
    expect(esRutaActiva("/repaso/", "/repaso")).toBe(true);
  });

  /**
   * Comparación exacta, no por prefijo: con `startsWith`, estando en
   * `/biblioteca` se marcaría también un futuro `/biblio`, y al revés
   * `/repaso-viejo` marcaría `/repaso`.
   */
  it("no marca una ruta que solo empieza igual", () => {
    expect(esRutaActiva("/repaso-viejo", "/repaso")).toBe(false);
    expect(esRutaActiva("/repaso", "/rep")).toBe(false);
  });
});
