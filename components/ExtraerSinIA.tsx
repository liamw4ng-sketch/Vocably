"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { textoDePaginas } from "@/lib/extraer/pdf-texto";
import { candidatasDeTexto, type Candidata } from "@/lib/extraer/candidatas";
import {
  sinEspanolEnNingunOrigen,
  traduccionParaGuardar,
} from "@/lib/diccionario/traduccion";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

export type Sugerencia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  frase: string;
  /** El español de la acepción: el volcado inglés o lo que dejó "Afinar con IA". */
  traducciones: string[];
  /** El español de la palabra: definiciones enteras del Wikcionario español. */
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
  /** La frase del libro. Sin esto la tarjeta nace sin contexto que enseñar. */
  context: string;
};

/**
 * La fuente de la que colgará lo guardado: el libro y las páginas que eligió el
 * usuario. Repetida aquí a propósito, como `Sugerencia`: es el contrato de la
 * ruta, y el tipo de verdad (`FuenteDeExtraccion`) vive en el repositorio, del
 * lado del servidor.
 */
type FuenteDeExtraccion = {
  title: string;
  pageStart: number;
  pageEnd: number;
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
 * Qué se guarda en el reverso de la tarjeta de esta sugerencia. Es la escalera
 * de la pantalla del diccionario, tal cual y compartida con ella
 * (`lib/diccionario/traduccion.ts`): lo escrito a mano, si lo hay; si no, el
 * español de la acepción; si no, **el primero** del español de la palabra.
 *
 * El último escalón es el que importa aquí: `significados` son hasta cinco
 * definiciones enteras del Wikcionario español, con su punto final y sus comas
 * dentro. Encadenarlas con `join(", ")` daba reversos como
 * "Idioma., Lengua, lenguaje., Léxico, jerga, vocabulario., …" — la regla que
 * este proyecto ya desechó una vez, y que esta pantalla reintrodujo en la vía
 * que guarda cuarenta palabras de golpe.
 */
export function traduccionDeLaSugerencia(sugerencia: Sugerencia, manual: string): string {
  return traduccionParaGuardar(manual, sugerencia.traducciones, sugerencia.significados);
}

/**
 * Si esta sugerencia no tiene todavía nada que poner en el reverso. Guardarla
 * así dejaría `translation: ""`: una tarjeta de repaso con el reverso en
 * blanco, indistinguible de una completa en la lista, que solo se descubre
 * vacía días después, en mitad de una sesión.
 *
 * Mira **los tres orígenes**, no la longitud de una lista: la traducción
 * escrita a mano cuenta igual que las automáticas, y una lista que solo trae
 * cadenas vacías no es español que guardar. Que la de a mano cuente es lo que
 * permite bloquear la casilla sin dejar sin salida a los verbos frasales —el
 * volcado español no cubre ni tres de doce corrientes—, que son la razón de ser
 * de esta pantalla y lo que la especificación pone primero de todo.
 */
export function sinTraduccionAlEspanol(sugerencia: Sugerencia, manual: string): boolean {
  return traduccionDeLaSugerencia(sugerencia, manual) === "";
}

/**
 * Lo que se manda a `POST /api/terms` de todo lo marcado.
 *
 * Aquí se juntan las tres cosas que una tarjeta necesita y que se perdían por
 * el camino: el reverso de la escalera, la frase del libro —que se enseñaba en
 * pantalla y se tiraba al guardar, y sin la cual el repaso no enseña ningún
 * contexto— y el nivel medido de cada palabra.
 *
 * Descarta lo que se haya quedado sin traducción aunque siguiera marcado: pasa
 * si se marca una línea con la traducción escrita a mano y luego se borra.
 */
export function entradasParaGuardar(
  sugerencias: Sugerencia[],
  marcadas: Iterable<number>,
  manuales: Record<number, string>,
  suelo: string,
): EntradaParaGuardar[] {
  const entradas: EntradaParaGuardar[] = [];
  for (const indice of marcadas) {
    const s = sugerencias[indice];
    if (!s) continue;
    const translation = traduccionDeLaSugerencia(s, manuales[indice] ?? "");
    if (!translation) continue;
    entradas.push({
      term: s.term,
      pos: s.pos,
      gloss: s.gloss,
      example: s.example,
      translation,
      level: nivelParaGuardar(s.nivel, suelo),
      context: s.frase,
    });
  }
  return entradas;
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

/**
 * Lo que se lee en pantalla en cada uno de esos dos casos.
 *
 * El texto de "sin-texto" nombra **las dos causas**, y no dice cuál es más
 * probable: `lib/extraer/pdf-texto.ts` explica que desde ahí un escaneo y unas
 * páginas genuinamente en blanco son indistinguibles, y prohíbe expresamente la
 * redacción de «parece un escaneo». Es el mismo criterio de honestidad que el
 * aviso de al lado, que tampoco finge saber por qué no salió nada nuevo.
 */
export function textoDelAviso(aviso: "sin-texto" | "nada-nuevo"): string {
  if (aviso === "sin-texto") {
    return (
      "No se ha encontrado texto en ese rango de páginas. Puede ser que el PDF sea un escaneo " +
      "—una imagen del texto, sin una capa de texto que se pueda leer— o que esas páginas estén " +
      "en blanco: desde aquí no se distingue un caso del otro."
    );
  }
  return (
    "No hay ninguna palabra nueva que enseñar. Puede ser que el nivel mínimo elegido deje fuera " +
    "todo el vocabulario de estas páginas, o que ya tengas guardado todo lo que hay: no se puede " +
    "distinguir un caso del otro desde aquí."
  );
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
 *
 * Va también la fuente: el libro y el rango de páginas. Sin ella, lo extraído
 * de un PDF colgaba de la fuente "Diccionario", que existe justamente para
 * separar lo buscado a mano de lo que sale de un libro, y el filtro por fuente
 * de la biblioteca mezclaba las dos cosas.
 */
export async function guardarMarcadas(
  entradas: EntradaParaGuardar[],
  fuente: FuenteDeExtraccion,
  fetchImpl: typeof fetch = fetch,
): Promise<{ creadas: number; repetidas: number; fallidas: number }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entradas, fuente }),
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
  // El título del libro, igual que en la extracción con IA: es el nombre de la
  // fuente de la que colgará todo lo guardado. Vacío, sirve el del fichero.
  const [titulo, setTitulo] = useState("");
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
  // La traducción escrita a mano, por línea. Es la salida de los verbos
  // frasales, que casi nunca traen español: sin ella, el bloque que la
  // especificación pone primero aparecía entero y entero inhabilitado. Mismo
  // campo, y mismo motivo, que en la pantalla del diccionario.
  const [traduccionesManuales, setTraduccionesManuales] = useState<Record<number, string>>({});
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
    // Las traducciones a mano se van con la lista que las pedía: los índices de
    // la nueva no son los de la vieja, y arrastrarlas pondría el reverso de una
    // palabra en otra.
    setTraduccionesManuales({});
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

  function desmarcar(indice: number) {
    setMarcadas((previas) => {
      if (!previas.has(indice)) return previas;
      const siguientes = new Set(previas);
      siguientes.delete(indice);
      return siguientes;
    });
  }

  /**
   * Escribir la traducción a mano de una línea. Si al borrarla la línea se
   * queda sin español de ningún origen, se desmarca: una casilla marcada y a la
   * vez deshabilitada no se puede quitar, y guardaría el reverso en blanco.
   */
  function escribirTraduccion(indice: number, valor: string, sugerencia: Sugerencia) {
    setTraduccionesManuales((previas) => ({ ...previas, [indice]: valor }));
    if (sinTraduccionAlEspanol(sugerencia, valor)) desmarcar(indice);
  }

  async function guardar() {
    if (!sugerencias || marcadas.size === 0 || guardando || !file) return;
    setError("");
    setGuardando(true);
    try {
      const entradas = entradasParaGuardar(sugerencias, marcadas, traduccionesManuales, suelo);
      const resultado = await guardarMarcadas(entradas, {
        title: titulo.trim() || file.name,
        pageStart,
        pageEnd,
        level: suelo,
      });
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

        {/* El título nombra la fuente de la que colgará todo lo guardado, igual
            que en la extracción con IA. Vacío, sirve el nombre del fichero. */}
        <Campo
          id="titulo-libro-sin-ia"
          etiqueta="Título del libro (opcional)"
          value={titulo}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitulo(e.target.value)}
        />

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

      {aviso && <p className="text-texto-suave">{textoDelAviso(aviso)}</p>}

      {sugerencias && sugerencias.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {sugerencias.map((s, indice) => {
              const manual = traduccionesManuales[indice] ?? "";
              const sinTraduccion = sinTraduccionAlEspanol(s, manual);
              // El aviso mira solo los orígenes automáticos: sale para explicar
              // por qué hace falta escribirla a mano, y tiene que seguir ahí
              // mientras se escribe.
              const sinEspanolAutomatico = sinEspanolEnNingunOrigen(s.traducciones, s.significados);
              return (
                <Tarjeta key={`${s.term}-${indice}`}>
                  {/* La casilla va fuera de la etiqueta que envuelve el resto:
                      dentro de un `<label>` no puede haber otro control, o
                      escribir la traducción a mano marcaría la casilla. */}
                  <div className="flex items-start gap-3">
                    <input
                      id={`marcar-sin-ia-${indice}`}
                      type="checkbox"
                      checked={marcadas.has(indice)}
                      onChange={() => alternarMarcada(indice)}
                      disabled={sinTraduccion}
                      className="mt-1"
                    />
                    <div className="flex flex-1 flex-col gap-2">
                      <label htmlFor={`marcar-sin-ia-${indice}`} className="cursor-pointer">
                        <strong>{s.term}</strong>
                        {etiquetaDeTipo(s.tipo) && (
                          <span style={TEXTO_1} className="text-texto-suave">
                            {" "}
                            · {etiquetaDeTipo(s.tipo)}
                          </span>
                        )}
                      </label>
                      <p className="italic text-texto-suave">{s.frase}</p>
                      {/* El español de la acepción primero, que es el que se
                          guarda; debajo el de la palabra, que son definiciones
                          enteras y por eso van en lista y no encadenadas. */}
                      {s.traducciones.length > 0 && <p>→ {s.traducciones.join(", ")}</p>}
                      {s.significados.length > 0 && (
                        <ol className="flex list-inside list-decimal flex-col gap-1">
                          {/* El índice como clave: es una lista estática. */}
                          {s.significados.map((significado, i) => (
                            <li key={i}>{significado}</li>
                          ))}
                        </ol>
                      )}
                      {sinEspanolAutomatico && (
                        <p style={TEXTO_1} className="text-texto-suave">
                          Sin traducción al español en ningún origen. Escríbela aquí abajo y podrás
                          guardarla; es lo que pasa casi siempre con los verbos frasales.
                        </p>
                      )}
                      <Campo
                        id={`traduccion-sin-ia-${indice}`}
                        etiqueta="Traducción a mano"
                        value={manual}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          escribirTraduccion(indice, e.target.value, s)
                        }
                      />
                      <p style={TEXTO_1} className="text-texto-suave">
                        {etiquetaDeNivel(s.nivel)}
                      </p>
                    </div>
                  </div>
                </Tarjeta>
              );
            })}
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
