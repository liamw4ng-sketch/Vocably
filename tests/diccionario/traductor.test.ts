import { describe, it, expect, vi } from "vitest";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";

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
});
