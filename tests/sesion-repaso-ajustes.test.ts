import { describe, it, expect, vi, afterEach } from "vitest";
import { guardarAjuste } from "@/components/SesionRepaso";

/**
 * `guardarAjuste` es la función que `useAjusteNumerico` (en
 * `SesionRepaso.tsx`) espera sin capturar su propio `await`. Un `fetch` que
 * lanza (sin conexión, DNS, servidor caído) se propagaría sin capturar y
 * dejaría el campo deshabilitado para siempre. Estas pruebas cubren el nivel
 * al que se puede probar sin un arnés de componentes (este proyecto usa
 * `environment: "node"` en vitest, sin jsdom ni @testing-library/react): la
 * función pura que hace la petición, no el componente que la envuelve.
 */
describe("guardarAjuste", () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it("si la red falla, devuelve un error en español en vez de lanzar", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    // Antes del arreglo esto habría rechazado (el `fetch` sin capturar se
    // propaga), dejando a quien llama con una promesa que nunca resuelve en
    // éxito ni en un error manejable.
    const resultado = await guardarAjuste("newCardsPerDay", 5);

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

    const resultado = await guardarAjuste("newCardsPerDay", 7);
    expect(resultado).toEqual({ valor: 7 });
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

    const resultado = await guardarAjuste("newCardsPerDay", 999);
    expect(resultado).toEqual({ error: "Debe ser un entero entre 0 y 200." });
  });

  it("lee del cuerpo el campo que ha guardado, no siempre el tope", async () => {
    // Sin esto, guardar los repasos por sesión devolvería el valor enviado
    // aunque el servidor hubiera guardado otro, y el campo enseñaría un
    // número que no está en la base de datos.
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ newCardsPerDay: 20, reviewsPerSession: 12 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    expect(await guardarAjuste("reviewsPerSession", 12)).toEqual({ valor: 12 });
  });

  it("manda solo el campo que cambia", async () => {
    const espia = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ reviewsPerSession: 30 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    global.fetch = espia as unknown as typeof fetch;

    await guardarAjuste("reviewsPerSession", 30);
    const [, opciones] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(opciones.body))).toEqual({ reviewsPerSession: 30 });
  });
});