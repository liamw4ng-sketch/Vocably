import type { CartaCola } from "@/db/repository/review";

export type Valoracion = 1 | 2 | 3 | 4;

export type EnvioRespuesta = {
  answerId: string;
  termId: number;
  rating: Valoracion;
};

export type Resumen = {
  total: number;
  otraVez: number;
  dificil: number;
  bien: number;
  facil: number;
  /** Cuántas respuestas nunca llegaron al servidor tras agotar los reintentos. */
  noGuardadas: number;
};

export type Sesion = {
  cartaActual: () => CartaCola | null;
  responder: (rating: Valoracion) => void;
  progreso: () => { hechas: number; total: number };
  /** Promesa que se resuelve cuando no queda ningún envío en vuelo. */
  pendientes: () => Promise<void>;
  resumen: () => Resumen;
  /** termIds cuyas respuestas nunca se guardaron: agotaron los reintentos. */
  fallidas: () => number[];
};

export type OpcionesSesion = {
  enviar: (r: EnvioRespuesta) => Promise<unknown>;
  reintentoMs?: number;
  /** Inyectable para que las pruebas no dependan de crypto. */
  generarId?: () => string;
};

/** Número total de intentos de envío antes de darse por vencido (1 inicial + 4 reintentos). */
const MAX_INTENTOS = 5;
/** Espera entre reintentos por defecto, en milisegundos. */
const REINTENTO_MS_POR_DEFECTO = 1000;

/**
 * La pantalla avanza en cuanto se pulsa un botón; el envío viaja aparte y se
 * reintenta con el MISMO identificador, que es lo que hace que un reintento no
 * pueda aplicar la valoración dos veces.
 */
export function crearSesion(cartas: CartaCola[], opts: OpcionesSesion): Sesion {
  const generarId =
    opts.generarId ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const reintentoMs = opts.reintentoMs ?? REINTENTO_MS_POR_DEFECTO;

  let indice = 0;
  const conteo = { total: 0, otraVez: 0, dificil: 0, bien: 0, facil: 0 };
  const enVuelo = new Set<Promise<void>>();
  const fallidas: number[] = [];

  async function enviarConReintento(envio: EnvioRespuesta): Promise<void> {
    for (let intento = 0; ; intento += 1) {
      try {
        await opts.enviar(envio);
        return;
      } catch {
        if (intento >= MAX_INTENTOS - 1) {
          fallidas.push(envio.termId); // se abandona tras agotar los intentos
          return;
        }
        await new Promise((r) => setTimeout(r, reintentoMs));
      }
    }
  }

  return {
    cartaActual: () => cartas[indice] ?? null,

    responder(rating) {
      const carta = cartas[indice];
      if (!carta) return;
      indice += 1;

      conteo.total += 1;
      if (rating === 1) conteo.otraVez += 1;
      else if (rating === 2) conteo.dificil += 1;
      else if (rating === 3) conteo.bien += 1;
      else conteo.facil += 1;

      const tarea = enviarConReintento({
        answerId: generarId(),
        termId: carta.termId,
        rating,
      });
      const seguimiento = tarea.finally(() => enVuelo.delete(seguimiento));
      enVuelo.add(seguimiento);
    },

    progreso: () => ({ hechas: indice, total: cartas.length }),

    async pendientes() {
      while (enVuelo.size > 0) await Promise.all([...enVuelo]);
    },

    resumen: () => ({ ...conteo, noGuardadas: fallidas.length }),

    fallidas: () => [...fallidas],
  };
}
