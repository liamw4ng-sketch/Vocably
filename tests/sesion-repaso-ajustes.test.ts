import { describe, it, expect, vi, afterEach } from "vitest";
import { guardarAjuste, guardarAjustes } from "@/components/SesionRepaso";

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
        new Response(JSON.stringify({ newCardsPerDay: 20, sessionSize: 12 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    expect(await guardarAjuste("sessionSize", 12)).toEqual({ valor: 12 });
  });

  it("manda solo el campo que cambia", async () => {
    const espia = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sessionSize: 30 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    global.fetch = espia as unknown as typeof fetch;

    await guardarAjuste("sessionSize", 30);
    const [, opciones] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(opciones.body))).toEqual({ sessionSize: 30 });
  });
});

/**
 * `guardarAjustes` es la de verdad: la que llama la pantalla previa al pulsar
 * "Empezar" con "Recordar esta elección" marcada. `guardarAjuste` (singular)
 * es hoy un envoltorio suyo para un campo numérico. Se prueba igual que su
 * hermana —espiando `global.fetch`—, y sin montar nada: es una función de
 * módulo que recibe un objeto y hace una petición, no estado de React.
 */
describe("guardarAjustes", () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  /** Deja `fetch` contestando lo que se le diga y devuelve el espía. */
  function respondiendo(cuerpo: unknown, status = 200) {
    const espia = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(cuerpo), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    global.fetch = espia as unknown as typeof fetch;
    return espia;
  }

  it("manda un solo PATCH con el número y el modo en el mismo cuerpo", async () => {
    // Antes eran dos idas y vueltas seguidas antes de pedir la cola. La ruta
    // acepta varios ajustes a la vez, así que empezar cuesta una petición.
    const espia = respondiendo({ sessionSize: 20, sessionMode: "aprendidas" });

    await guardarAjustes({ sessionSize: 20, sessionMode: "aprendidas" });

    expect(espia).toHaveBeenCalledTimes(1);
    const [url, opciones] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ajustes");
    expect(opciones.method).toBe("PATCH");
    expect(JSON.parse(String(opciones.body))).toEqual({
      sessionSize: 20,
      sessionMode: "aprendidas",
    });
  });

  it("devuelve los ajustes que dice tener el servidor", async () => {
    respondiendo({ sessionSize: 20, sessionMode: "mezcla" });

    expect(await guardarAjustes({ sessionSize: 20 })).toEqual({
      ajustes: { sessionSize: 20, sessionMode: "mezcla" },
    });
  });

  it("si el servidor rechaza el cambio, devuelve su mensaje", async () => {
    respondiendo({ error: "Modo desconocido." }, 400);

    expect(await guardarAjustes({ sessionMode: "mezcla" })).toEqual({
      error: "Modo desconocido.",
    });
  });

  it("si el servidor rechaza sin decir por qué, da un mensaje en español", async () => {
    // Sin esto, la pantalla compondría "undefined Tu elección no se ha
    // guardado para la próxima vez."
    respondiendo("", 500);

    expect(await guardarAjustes({ sessionSize: 5 })).toEqual({
      error: "No se pudo guardar el cambio.",
    });
  });

  it("si la red falla, devuelve un mensaje en español en vez de lanzar", async () => {
    // `arrancar` llama a esto dentro de su try, pero un rechazo aquí caería en
    // el mismo `catch` que los fallos de la cola y la pantalla diría "No se
    // pudo cargar el repaso": no haber podido guardar una preferencia no
    // puede tumbar la sesión.
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    const resultado = await guardarAjustes({ sessionSize: 5, sessionMode: "mezcla" });

    expect("error" in resultado).toBe(true);
    if ("error" in resultado) {
      expect(resultado.error).toBe(
        "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo otra vez.",
      );
    }
  });
});