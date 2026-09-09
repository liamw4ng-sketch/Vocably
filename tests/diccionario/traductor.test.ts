import { describe, it, expect, vi } from "vitest";
import { crearTraductorMyMemory, cuotaAgotada } from "@/lib/diccionario/traductor";

const respuestaOk = {
  responseData: { translatedText: "renuente" },
  matches: [{ translation: "reacio" }, { translation: "renuente" }, { translation: "" }],
};

describe("crearTraductorMyMemory", () => {
  it("manda el término solo, nunca pegado a su definición", async () => {
    // Tipado explícito de `vi.fn`: sin esto, TypeScript infiere una función sin
    // parámetros y `mock.calls[0]` queda como una tupla vacía sin índice 0.
    const fetchFalso = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(respuestaOk)));
    await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant");

    const url = String(fetchFalso.mock.calls[0][0]);
    expect(url).toContain("q=reluctant");
    expect(url).toContain("langpair=en%7Ces");
    expect(url).not.toContain("Not+wanting");
  });

  it("devuelve la traducción principal y las alternativas, sin repetir ni vacías", async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(respuestaOk)));
    const traducciones = await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant");
    expect(traducciones).toEqual(["renuente", "reacio"]);
  });

  it("si el servicio falla devuelve vacío en vez de reventar la búsqueda", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant")).toEqual([]);
  });

  it("una respuesta con error HTTP también devuelve vacío", async () => {
    const fetchFalso = vi.fn(async () => new Response("nope", { status: 503 }));
    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant")).toEqual([]);
  });

  it("manda un plazo: la petición lleva su AbortSignal", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(respuestaOk)));
    await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant");

    const opciones = fetchFalso.mock.calls[0][1];
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
    expect(opciones?.signal?.aborted).toBe(false);
  });

  it("un servicio colgado se corta solo y devuelve vacío en vez de esperar para siempre", async () => {
    // No se cae: se queda callado. Sin plazo, esta promesa no se resolvería
    // nunca y la búsqueda entera se quedaría esperando con ella.
    const fetchColgado = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolver, rechazar) => {
          init?.signal?.addEventListener("abort", () =>
            rechazar(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const traductor = crearTraductorMyMemory(fetchColgado as unknown as typeof fetch, 20);
    expect(await traductor("reluctant")).toEqual([]);
  });

  /**
   * El fallo que esto arregla: MyMemory contesta **200** con el aviso dentro del
   * campo de la traducción. Sin comprobarlo, "MYMEMORY WARNING: YOU USED ALL
   * AVAILABLE FREE TRANSLATIONS FOR TODAY" acabaría pintado en pantalla como si
   * fuera el español de la palabra, y guardado en una tarjeta de repaso.
   */
  it("con la cuota agotada devuelve vacío, no el aviso del servicio", async () => {
    const cuotaAgotada = {
      responseData: {
        translatedText:
          "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 10 HOURS 26 MINUTES",
      },
      quotaFinished: true,
      responseStatus: 403,
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuotaAgotada)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  it("también cuando el estado viene como cadena", async () => {
    const cuerpo = { responseData: { translatedText: "algo" }, responseStatus: "403" };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  /**
   * MyMemory ha movido `quotaFinished` entre la raíz y `responseData` según la
   * versión, así que se mira en los dos sitios.
   */
  it("también cuando quotaFinished viene dentro de responseData", async () => {
    const cuerpo = {
      responseData: { translatedText: "algo", quotaFinished: true },
      responseStatus: 200,
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  /**
   * Cinturón y tirantes: aunque el estado dijera 200 y nadie marcara la cuota,
   * un texto que empieza por la marca del aviso no es una traducción.
   */
  it("descarta las candidatas que traen la marca del aviso", async () => {
    const cuerpo = {
      responseStatus: 200,
      responseData: { translatedText: "MYMEMORY WARNING: something" },
      matches: [{ translation: "perro" }],
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual(["perro"]);
  });
});

describe("cuotaAgotada", () => {
  it("una respuesta buena no lo está", () => {
    expect(cuotaAgotada({ responseStatus: 200, responseData: { translatedText: "perro" } })).toBe(false);
  });

  it("lo está si el estado no es 200, venga como número o como cadena", () => {
    expect(cuotaAgotada({ responseStatus: 403 })).toBe(true);
    expect(cuotaAgotada({ responseStatus: "403" })).toBe(true);
  });

  it("lo está si alguien marca quotaFinished, en la raíz o dentro", () => {
    expect(cuotaAgotada({ responseStatus: 200, quotaFinished: true })).toBe(true);
    expect(cuotaAgotada({ responseStatus: 200, responseData: { quotaFinished: true } })).toBe(true);
  });

  /**
   * Sin estado no se puede afirmar que la cuota esté agotada. El camino de un
   * cuerpo raro ya está cubierto: sin traducciones utilizables se devuelve
   * vacío igual.
   */
  it("un cuerpo sin estado no se da por agotado", () => {
    expect(cuotaAgotada({})).toBe(false);
    expect(cuotaAgotada(null)).toBe(false);
  });
});
