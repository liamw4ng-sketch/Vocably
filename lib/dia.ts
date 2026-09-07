/**
 * Dónde empieza "hoy".
 *
 * El tope de tarjetas nuevas es diario, así que hace falta una definición de
 * día. La app tiene una sola usuaria, en España: el día es el suyo, el que
 * empieza a medianoche en Madrid, no a medianoche UTC (que en verano son las
 * 2 de la madrugada de aquí, con lo que un repaso a la 1:00 contaría contra
 * el cupo del día anterior). No se guarda en base de datos ni se envía desde
 * el navegador: si algún día la usuaria se muda, esto es una línea.
 */
export const ZONA_HORARIA = "Europe/Madrid";

const formateador = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Partes = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** La hora de pared en Madrid de un instante dado. */
function partesEnZona(instante: Date): Partes {
  const leidas = Object.fromEntries(
    formateador.formatToParts(instante).map((parte) => [parte.type, parte.value]),
  );
  return {
    year: Number(leidas.year),
    month: Number(leidas.month),
    day: Number(leidas.day),
    hour: Number(leidas.hour),
    minute: Number(leidas.minute),
    second: Number(leidas.second),
  };
}

/** Desplazamiento de la zona en ese instante, en milisegundos (+2 h en verano). */
function desplazamiento(instante: Date): number {
  const p = partesEnZona(instante);
  const horaDePared = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Se recortan los milisegundos del instante: el formateador no los da, y sin
  // recortarlos el desplazamiento saldría desplazado por esa fracción.
  return horaDePared - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * La medianoche de Madrid del día al que pertenece `ahora`, como instante.
 *
 * Se calcula en TypeScript a partir del `now` que ya recibe el repositorio,
 * nunca con `new Date()`: así las pruebas siguen mandando sobre el reloj.
 *
 * Dos pasadas a propósito. La primera usa el desplazamiento del instante
 * dado, que en los dos domingos de cambio de hora al año no es el mismo que
 * el de la medianoche de ese día (el 29 de marzo a mediodía Madrid va +2,
 * pero su medianoche fue todavía +1). La segunda lo recalcula ya sobre la
 * medianoche candidata y la coloca donde toca.
 */
export function inicioDelDia(ahora: Date): Date {
  const { year, month, day } = partesEnZona(ahora);
  const medianocheDePared = Date.UTC(year, month - 1, day);
  const aproximada = new Date(medianocheDePared - desplazamiento(ahora));
  return new Date(medianocheDePared - desplazamiento(aproximada));
}
