import { normalizeTerm } from "@/lib/normalize";

export type FilaDiccionario = {
  termNormalized: string;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
};

/**
 * Glosas que Wikcionario incluye por completitud y que al usuario no le dicen
 * nada: remiten a otra entrada en vez de explicar el término. Son 2.749 en el
 * volcado, y salen como *primera* acepción de varios verbos frasales, así que
 * sin este filtro lo primero que se lee de "come across" es "see come, across".
 */
export function esGlosaInutil(gloss: string): boolean {
  const g = gloss.trim().toLowerCase();
  return (
    g.startsWith("used other than figuratively") ||
    g.startsWith("alternative form of") ||
    g.startsWith("alternative spelling of") ||
    g.startsWith("obsolete form of") ||
    g.startsWith("misspelling of")
  );
}

type LineaCruda = {
  w?: unknown;
  p?: unknown;
  s?: unknown;
};

/** Una entrada del volcado se convierte en una fila por acepción. */
export function filasDeLinea(linea: string): FilaDiccionario[] {
  let cruda: LineaCruda;
  try {
    cruda = JSON.parse(linea) as LineaCruda;
  } catch {
    // Una línea ilegible no puede abortar una carga de 181.103: se salta.
    return [];
  }

  // JSON.parse puede devolver null, números, strings, etc. Necesitamos un objeto.
  if (typeof cruda !== "object" || cruda === null) return [];

  const term = typeof cruda.w === "string" ? cruda.w.trim() : "";
  const pos = typeof cruda.p === "string" ? cruda.p : "";
  if (!term || !pos || !Array.isArray(cruda.s)) return [];

  const filas: FilaDiccionario[] = [];
  for (const acepcion of cruda.s) {
    if (typeof acepcion !== "object" || acepcion === null) continue;
    const { g, e, es } = acepcion as { g?: unknown; e?: unknown; es?: unknown };
    if (typeof g !== "string" || !g.trim() || esGlosaInutil(g)) continue;
    filas.push({
      termNormalized: normalizeTerm(term),
      term,
      pos,
      gloss: g.trim(),
      example: typeof e === "string" && e.trim() ? e.trim() : null,
      translations: Array.isArray(es) ? es.filter((t): t is string => typeof t === "string") : [],
    });
  }
  return filas;
}
