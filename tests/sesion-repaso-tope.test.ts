import { describe, it, expect, vi, afterEach } from "vitest";
import { guardarTope } from "@/components/SesionRepaso";

/**
 * `guardarTope` es la función que `confirmarTope` (en `SesionRepaso.tsx`)
 * espera sin capturar su propio `await`. Antes del hallazgo 1, un `fetch`
 * que lanzaba (sin conexión, DNS, servidor caído) se propagaba sin capturar
 * y dejaba el campo del tope deshabilitado para siempre. Estas pruebas
 * cubren el nivel al que se puede probar sin un arnés de componentes (este
 * proyecto usa `environment: "node"` en vitest, sin jsdom ni
 * @testing-library/react): la función pura que hace la petición, no el
 * componente que la envuelve.
 */
describe("guardarTope", () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it("si la red falla, devuelve un error en español en vez de lanzar", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    // Antes del arreglo esto habría rechazado (el `fetch` sin capturar se
    // propaga), dejando a quien llama con una promesa que nunca resuelve en
    // éxito ni en un error manejable.
    const resultado = await guardarTope(5);

    expect("error" in resultado).toBe(true);
    if ("error" in resultado) {
      expect(resultado.error.length).toBeGreaterThan(0);
    }
  });

  it("si el servidor acepta el valor, devuelve el tope guardado", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ newCardsPerDay: 7 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const resultado = await guardarTope(7);
    expect(resultado).toEqual({ tope: 7 });
  });

  it("si el servidor rechaza el valor, devuelve su mensaje de error", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Debe ser un entero entre 0 y 200." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const resultado = await guardarTope(999);
    expect(resultado).toEqual({ error: "Debe ser un entero entre 0 y 200." });
  });
});
