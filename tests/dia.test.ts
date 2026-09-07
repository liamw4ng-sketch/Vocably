import { describe, it, expect } from "vitest";
import { ZONA_HORARIA, inicioDelDia } from "@/lib/dia";

/** El instante que devuelve `inicioDelDia`, escrito como ISO para comparar. */
function inicio(iso: string): string {
  return inicioDelDia(new Date(iso)).toISOString();
}

describe("inicioDelDia", () => {
  it("la zona es la de la usuaria, no UTC", () => {
    expect(ZONA_HORARIA).toBe("Europe/Madrid");
  });

  it("en verano (UTC+2) la medianoche de Madrid son las 22:00 UTC del día anterior", () => {
    expect(inicio("2026-09-10T09:00:00Z")).toBe("2026-09-09T22:00:00.000Z");
  });

  it("en invierno (UTC+1) son las 23:00 UTC del día anterior", () => {
    expect(inicio("2026-01-15T09:00:00Z")).toBe("2026-01-14T23:00:00.000Z");
  });

  it("la madrugada de Madrid pertenece al día que acaba de empezar, no al anterior", () => {
    // 23:30 UTC del 9 es la 1:30 del 10 en Madrid: su día empezó hace una
    // hora y media, no hace veinticinco.
    expect(inicio("2026-09-09T23:30:00Z")).toBe("2026-09-09T22:00:00.000Z");
  });

  it("el mismo instante en UTC y en Madrid caen en días distintos", () => {
    const instante = new Date("2026-09-09T23:30:00Z");
    // La medianoche UTC de ese instante sería el 9 a las 00:00Z; la de Madrid
    // es el 10 a las 00:00 locales. Si coincidieran, la zona no se estaría
    // aplicando.
    expect(inicioDelDia(instante).toISOString()).not.toBe("2026-09-09T00:00:00.000Z");
  });

  it("el domingo en que se adelanta la hora, la medianoche fue todavía UTC+1", () => {
    // 29 de marzo de 2026: a las 2:00 locales el reloj salta a las 3:00. A
    // mediodía Madrid ya va +2, pero la medianoche de ese día ocurrió con el
    // desplazamiento antiguo. Con una sola pasada saldría una hora antes.
    expect(inicio("2026-03-29T12:00:00Z")).toBe("2026-03-28T23:00:00.000Z");
  });

  it("el domingo en que se atrasa la hora, la medianoche fue todavía UTC+2", () => {
    // 25 de octubre de 2026: a las 3:00 locales el reloj vuelve a las 2:00.
    expect(inicio("2026-10-25T12:00:00Z")).toBe("2026-10-24T22:00:00.000Z");
  });

  it("un instante que ya es medianoche exacta en Madrid se devuelve tal cual", () => {
    expect(inicio("2026-09-09T22:00:00Z")).toBe("2026-09-09T22:00:00.000Z");
  });
});
