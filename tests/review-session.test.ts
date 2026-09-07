import { describe, it, expect, vi } from "vitest";
import { crearSesion, type EnvioRespuesta } from "@/lib/review-session";

const plazos = { 1: "1 min", 2: "10 min", 3: "1 día", 4: "4 días" };

const cartas = [
  { termId: 1, term: "a", translation: "a", type: "word", level: "B2", senseHint: "", context: "c1", example: "e1", esNueva: true, plazos },
  { termId: 2, term: "b", translation: "b", type: "word", level: "B2", senseHint: "", context: "c2", example: "e2", esNueva: true, plazos },
];

const ok = () => Promise.resolve({ aplicada: true, proximaFecha: new Date() });

describe("sesión de repaso", () => {
  it("avanza a la siguiente carta sin esperar al servidor", async () => {
    let resolver: (v: unknown) => void = () => {};
    const enviar = vi.fn(() => new Promise((r) => { resolver = r; }));
    const s = crearSesion(cartas, { enviar });

    expect(s.cartaActual()?.termId).toBe(1);
    s.responder(3);
    expect(s.cartaActual()?.termId).toBe(2); // ya avanzó, con el envío en vuelo
    resolver({ aplicada: true, proximaFecha: new Date() });
  });

  it("envía un identificador distinto por respuesta", async () => {
    const enviar = vi.fn<(envio: EnvioRespuesta) => Promise<unknown>>(ok);
    const s = crearSesion(cartas, { enviar });
    s.responder(3);
    s.responder(1);
    await s.pendientes();

    const ids = enviar.mock.calls.map((c) => c[0].answerId);
    expect(new Set(ids).size).toBe(2);
  });

  it("reintenta una respuesta que falló, con el mismo identificador", async () => {
    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockImplementation(ok);
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    await s.pendientes();

    expect(enviar).toHaveBeenCalledTimes(2);
    const [primera, segunda] = enviar.mock.calls.map((c) => c[0] as { answerId: string });
    expect(segunda.answerId).toBe(primera.answerId);
  });

  it("no pierde respuestas si varias fallan seguidas", async () => {
    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockRejectedValueOnce(new Error("red"))
      .mockImplementation(ok);
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    s.responder(2);
    await s.pendientes();

    const enviadas = enviar.mock.calls.map((c) => (c[0] as { termId: number }).termId);
    expect(new Set(enviadas)).toEqual(new Set([1, 2]));
  });

  it("informa del progreso", () => {
    const s = crearSesion(cartas, { enviar: ok });
    expect(s.progreso()).toEqual({ hechas: 0, total: 2 });
    s.responder(3);
    expect(s.progreso()).toEqual({ hechas: 1, total: 2 });
  });

  it("al terminar no hay carta actual y el resumen cuadra", async () => {
    const s = crearSesion(cartas, { enviar: ok });
    s.responder(3);
    s.responder(1);
    await s.pendientes();

    expect(s.cartaActual()).toBeNull();
    expect(s.resumen()).toEqual({ total: 2, otraVez: 1, dificil: 0, bien: 1, facil: 0, noGuardadas: 0 });
  });

  it("con una cola vacía termina de inmediato", () => {
    const s = crearSesion([], { enviar: ok });
    expect(s.cartaActual()).toBeNull();
    expect(s.progreso()).toEqual({ hechas: 0, total: 0 });
  });

  it("registra como fallida una respuesta que agota los reintentos", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("red"));
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    await s.pendientes();

    expect(s.fallidas()).toEqual([1]);
    expect(s.resumen().noGuardadas).toBe(1);
  });

  it("no registra ninguna fallida cuando el envío tiene éxito", async () => {
    const s = crearSesion(cartas, { enviar: ok });
    s.responder(3);
    await s.pendientes();

    expect(s.fallidas()).toEqual([]);
    expect(s.resumen().noGuardadas).toBe(0);
  });

  it("acumula varias fallidas si más de una respuesta agota los reintentos", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("red"));
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    s.responder(2);
    await s.pendientes();

    expect(new Set(s.fallidas())).toEqual(new Set([1, 2]));
    expect(s.resumen().noGuardadas).toBe(2);
  });
});
