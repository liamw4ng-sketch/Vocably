import { normalizeTerm } from "@/lib/normalize";

/**
 * Cuántos significados se guardan por palabra y categoría. El fichero filtrado
 * ya trae hasta ocho; recortar más al cargar ahorraría kilobytes y costaría una
 * descarga de 95 MB el día que se quieran seis en pantalla.
 */
export const MAXIMO_SIGNIFICADOS_GUARDADOS = 8;

/** Cuántos se enseñan. Es lo que pidió el usuario. */
export const MAXIMO_SIGNIFICADOS_MOSTRADOS = 5;

export type FilaEspanola = {
  termNormalized: string;
  term: string;
  pos: string;
  meanings: string[];
};

type LineaCruda = {
  w?: unknown;
  p?: unknown;
  s?: unknown;
};

/**
 * Una línea del volcado del Wikcionario español se convierte en una fila.
 *
 * Formato: `{"w": palabra, "p": categoría, "s": [significado, ...]}`, donde `s`
 * es una lista de **cadenas**. Ojo: en el volcado inglés `s` es una lista de
 * objetos (`lib/diccionario/entrada.ts`). Son dos formatos distintos.
 *
 * Devuelve `null` en vez de lanzar: una línea ilegible no puede abortar una
 * carga de 21.000.
 */
export function filaDeLineaEspanola(linea: string): FilaEspanola | null {
  let cruda: LineaCruda;
  try {
    cruda = JSON.parse(linea) as LineaCruda;
  } catch {
    return null;
  }

  // JSON.parse devuelve también null, números y cadenas: hace falta un objeto.
  if (typeof cruda !== "object" || cruda === null) return null;

  const term = typeof cruda.w === "string" ? cruda.w.trim() : "";
  const pos = typeof cruda.p === "string" ? cruda.p.trim() : "";
  if (!term || !pos || !Array.isArray(cruda.s)) return null;

  const meanings: string[] = [];
  for (const significado of cruda.s) {
    if (typeof significado !== "string") continue;
    const limpio = significado.trim();
    if (!limpio) continue;
    meanings.push(limpio);
    if (meanings.length === MAXIMO_SIGNIFICADOS_GUARDADOS) break;
  }
  if (meanings.length === 0) return null;

  return { termNormalized: normalizeTerm(term), term, pos, meanings };
}
