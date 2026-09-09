"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { textoDePaginas } from "@/lib/extraer/pdf-texto";
import { candidatasDeTexto, type Candidata } from "@/lib/extraer/candidatas";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

export type Sugerencia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  frase: string;
  significados: string[];
  nivel: string | null;
  tipo: "word" | "phrasal_verb" | "expression";
};

/** Lo que necesita `POST /api/terms` de cada candidata marcada. */
type EntradaParaGuardar = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translation: string;
  level: string;
};

/**
 * Lee el cuerpo de una respuesta sin dar por hecho que es JSON.
 *
 * Un 500 de verdad —una tabla que no existe, por ejemplo— puede llegar con
 * cuerpo HTML. Llamar a `res.json()` a pelo revienta con el mensaje interno
 * del navegador, que no ayuda a nadie.
 */
async function leerCuerpo(res: Response): Promise<{ error?: string } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Extraídas del componente y exportadas a propósito: este proyecto prueba en
 * `environment: "node"`, sin jsdom, así que la lógica que puede fallar vive en
 * funciones puras que sí se pueden probar. El componente solo pinta y guarda
 * estado. Mira `components/BuscadorDiccionario.tsx` para el mismo patrón.
 */

/**
 * Qué nivel se enseña de una candidata. Un verbo frasal no tiene nivel en
 * ninguna fuente gratuita: enseñar el suelo elegido como si fuera suyo sería
 * fingir una precisión que no existe, así que se dice que no lo hay.
 */
export function etiquetaDeNivel(nivel: string | null): string {
  return nivel ?? "sin nivel";
}

/**
 * Qué nivel se guarda en la tarjeta. `terms.level` no admite nulos, así que lo
 * que no tiene nivel medido hereda el suelo elegido — que es exactamente lo que
 * hace hoy la extracción con IA con **todas** sus palabras, así que no empeora
 * nada. La pantalla distingue las dos cosas con `etiquetaDeNivel`.
 */
export function nivelParaGuardar(nivel: string | null, suelo: string): string {
  return nivel ?? suelo;
}

/**
 * Por qué no hay nada que enseñar, que no es lo mismo según el caso. Un
 * resultado vacío sin explicación es lo que hace pensar que la herramienta está
 * rota.
 *
 * `hayTexto` distingue las dos causas raíz: sin texto extraído (probablemente
 * un escaneo) frente a texto que sí llegó al servidor pero no dejó ninguna
 * sugerencia nueva. Esta segunda causa tiene a su vez dos motivos posibles —el
 * suelo elegido, o que ya esté todo guardado— pero la pantalla no puede saber
 * cuál de los dos es, así que no finge saberlo.
 */
export function avisoSinSugerencias(
  hayTexto: boolean,
  numSugerencias: number,
): "sin-texto" | "nada-nuevo" | null {
  if (numSugerencias > 0) return null;
  return hayTexto ? "nada-nuevo" : "sin-texto";
}

/** Manda las candidatas de la extracción y el suelo elegido; devuelve las sugerencias que da el servidor, ya ordenadas. */
export async function pedirSugerencias(
  candidatas: Candidata[],
  suelo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sugerencia[]> {
  let res: Response;
  try {
    res = await fetchImpl("/api/extraer-sin-ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidatas, suelo }),
    });
  } catch {
    // Un fallo de red sin mensaje dejaría el formulario deshabilitado para
    // siempre, sin decirle nada al usuario.
    throw new Error("No se pudo analizar el texto: comprueba la conexión.");
  }
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) {
    throw new Error(
      cuerpo?.error ?? `El servidor no pudo analizar el texto (error ${res.status}).`,
    );
  }
  return ((cuerpo as { sugerencias?: Sugerencia[] } | null)?.sugerencias ?? []) as Sugerencia[];
}

/**
 * Todo lo marcado en **una sola petición**: cuarenta candidatas no pueden ser
 * cuarenta viajes. El servidor ya no aborta el lote si una entrada falla al
 * guardarse —cuenta `fallidas` y sigue con las demás—, así que la pantalla
 * tiene que poder enseñar ese número en vez de callárselo.
 */
export async function guardarMarcadas(
  entradas: EntradaParaGuardar[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ creadas: number; repetidas: number; fallidas: number }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entradas }),
    });
  } catch {
    throw new Error("No se pudo guardar: comprueba la conexión.");
  }
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) {
    throw new Error(
      cuerpo?.error ?? `El servidor no pudo guardar las palabras (error ${res.status}).`,
    );
  }
  return cuerpo as { creadas: number; repetidas: number; fallidas: number };
}

const TEXTO_1 = { fontSize: "var(--tamano-1)" };
const TEXTO_2 = { fontSize: "var(--tamano-2)" };

/** Cómo se llama en pantalla cada tipo de candidata que no es una palabra suelta. */
function etiquetaDeTipo(tipo: Sugerencia["tipo"]): string | null {
  if (tipo === "phrasal_verb") return "Verbo frasal";
  if (tipo === "expression") return "Expresión";
  return null;
}

export function ExtraerSinIA() {
  const [file, setFile] = useState<File | null>(null);
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(1);
  const [suelo, setSuelo] = useState<string>(CEFR_LEVELS[0]);

  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState("");
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  // Si hubo candidatas que mandar al servidor: distingue un PDF sin texto (o
  // sin candidatas reconocibles) de un texto que sí llegó pero no dejó ninguna
  // sugerencia nueva. Ver `avisoSinSugerencias`.
  const [hayTexto, setHayTexto] = useState(false);

  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [resultadoGuardado, setResultadoGuardado] = useState<{
    creadas: number;
    repetidas: number;
    fallidas: number;
  } | null>(null);

  async function analizar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!file) return;

    setError("");
    setSugerencias(null);
    setResultadoGuardado(null);
    setMarcadas(new Set());
    setAnalizando(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // El error de `textoDePaginas` (PDF cifrado, rango fuera del documento…)
      // se propaga tal cual: es más preciso que cualquier mensaje genérico que
      // esta pantalla pudiera inventarse encima.
      const texto = await textoDePaginas(bytes, pageStart, pageEnd);
      const candidatas = candidatasDeTexto(texto);
      setHayTexto(candidatas.length > 0);
      // Sin candidatas no hay nada que mandar: un PDF escaneado o con las
      // páginas en blanco no tiene por qué convertirse en un 400 del servidor.
      const nuevasSugerencias =
        candidatas.length > 0 ? await pedirSugerencias(candidatas, suelo) : [];
      setSugerencias(nuevasSugerencias);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el PDF.");
    } finally {
      setAnalizando(false);
    }
  }

  function alternarMarcada(indice: number) {
    setMarcadas((previas) => {
      const siguientes = new Set(previas);
      if (siguientes.has(indice)) siguientes.delete(indice);
      else siguientes.add(indice);
      return siguientes;
    });
  }

  async function guardar() {
    if (!sugerencias || marcadas.size === 0 || guardando) return;
    setError("");
    setGuardando(true);
    try {
      const entradas: EntradaParaGuardar[] = [...marcadas].map((indice) => {
        const s = sugerencias[indice];
        return {
          term: s.term,
          pos: s.pos,
          gloss: s.gloss,
          example: s.example,
          translation: s.significados.join(", "),
          level: nivelParaGuardar(s.nivel, suelo),
        };
      });
      const resultado = await guardarMarcadas(entradas);
      setResultadoGuardado(resultado);
      setMarcadas(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const aviso = sugerencias ? avisoSinSugerencias(hayTexto, sugerencias.length) : null;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={analizar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="pdf-sin-ia" style={TEXTO_1} className="text-texto-suave">
            El PDF
          </label>
          <input
            id="pdf-sin-ia"
            type="file"
            accept="application/pdf"
            onChange={(evento) => setFile(evento.target.files?.[0] ?? null)}
            className="min-h-12 w-full rounded-control border border-borde bg-superficie px-4 text-texto"
          />
        </div>

        <div className="flex gap-3">
          <Campo
            id="pagina-inicio-sin-ia"
            etiqueta="Desde la página"
            className="flex-1"
            type="number"
            inputMode="numeric"
            min={1}
            value={pageStart}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPageStart(Number(e.target.value))}
          />
          <Campo
            id="pagina-fin-sin-ia"
            etiqueta="Hasta la página"
            className="flex-1"
            type="number"
            inputMode="numeric"
            min={1}
            value={pageEnd}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPageEnd(Number(e.target.value))}
          />
        </div>

        <Campo
          id="suelo-sin-ia"
          etiqueta="Nivel mínimo"
          value={suelo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSuelo(e.target.value)}
          opciones={CEFR_LEVELS.map((nivel) => ({ valor: nivel, etiqueta: nivel }))}
          ayuda="Es un filtro, no una etiqueta: se descartan las palabras sueltas por debajo de este nivel. Los verbos frasales y las expresiones se muestran siempre, tengan el nivel que tengan."
        />

        <Boton type="submit" variante="primario" disabled={!file || analizando} className="w-full">
          {analizando ? "Analizando…" : "Buscar vocabulario"}
        </Boton>
      </form>

      {error && (
        <p role="alert" style={TEXTO_2} className="rounded-control border border-peligro p-4 text-peligro">
          {error}
        </p>
      )}

      {aviso === "sin-texto" && (
        <p className="text-texto-suave">
          No se ha encontrado texto en ese rango de páginas. La causa más probable es que el PDF
          sea un escaneo: una imagen del texto, sin una capa de texto que se pueda leer.
        </p>
      )}

      {aviso === "nada-nuevo" && (
        <p className="text-texto-suave">
          No hay ninguna palabra nueva que enseñar. Puede ser que el nivel mínimo elegido deje
          fuera todo el vocabulario de estas páginas, o que ya tengas guardado todo lo que hay: no
          se puede distinguir un caso del otro desde aquí.
        </p>
      )}

      {sugerencias && sugerencias.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {sugerencias.map((s, indice) => (
              <Tarjeta key={`${s.term}-${indice}`}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={marcadas.has(indice)}
                    onChange={() => alternarMarcada(indice)}
                    className="mt-1"
                  />
                  <div className="flex flex-col gap-2">
                    <p>
                      <strong>{s.term}</strong>
                      {etiquetaDeTipo(s.tipo) && (
                        <span style={TEXTO_1} className="text-texto-suave">
                          {" "}
                          · {etiquetaDeTipo(s.tipo)}
                        </span>
                      )}
                    </p>
                    <p className="italic text-texto-suave">{s.frase}</p>
                    {s.significados.length > 0 && <p>{s.significados.join(", ")}</p>}
                    <p style={TEXTO_1} className="text-texto-suave">
                      {etiquetaDeNivel(s.nivel)}
                    </p>
                  </div>
                </label>
              </Tarjeta>
            ))}
          </div>

          <Boton
            type="button"
            variante="primario"
            onClick={guardar}
            disabled={marcadas.size === 0 || guardando}
          >
            {guardando
              ? "Guardando…"
              : marcadas.size > 0
                ? `Guardar ${marcadas.size}`
                : "Guardar"}
          </Boton>
        </div>
      )}

      {resultadoGuardado && (
        <p style={TEXTO_2}>
          {resultadoGuardado.creadas} guardadas, {resultadoGuardado.repetidas} ya las tenías
          {resultadoGuardado.fallidas > 0 ? `, ${resultadoGuardado.fallidas} fallaron` : ""}.
        </p>
      )}
    </div>
  );
}
