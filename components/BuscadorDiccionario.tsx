"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

type Acepcion = {
  id: number;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
  yaGuardada: boolean;
};

type Resultado = {
  termino: string;
  enBiblioteca: { id: number; term: string; translation: string; level: string; senseHint: string }[];
  acepciones: Acepcion[];
};

/**
 * Extraídas del componente y exportadas a propósito: este proyecto prueba en
 * `environment: "node"`, sin jsdom, así que la lógica que puede fallar —la
 * petición, el error del servidor, la validación del nivel— vive en funciones
 * puras que sí se pueden probar. El componente solo pinta y guarda estado.
 */
export async function buscarTermino(
  consulta: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Resultado> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/diccionario?q=${encodeURIComponent(consulta.trim())}`);
  } catch {
    // Un fallo de red sin mensaje dejaría el formulario deshabilitado para
    // siempre, sin decirle nada al usuario.
    throw new Error("No se pudo buscar: comprueba la conexión.");
  }
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(cuerpo.error ?? "No se pudo buscar.");
  return cuerpo as Resultado;
}

export async function anadirAcepcion(
  acepcion: Acepcion,
  nivel: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // Sin nivel no se guarda, y se para aquí: que el servidor conteste 400 a algo
  // que la pantalla ya sabe que falta es un viaje perdido.
  if (!nivel) throw new Error("Elige un nivel antes de añadir.");

  let res: Response;
  try {
    res = await fetchImpl("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: acepcion.term,
        pos: acepcion.pos,
        gloss: acepcion.gloss,
        example: acepcion.example,
        translation: acepcion.translations.join(", "),
        level: nivel,
      }),
    });
  } catch {
    throw new Error("No se pudo añadir: comprueba la conexión.");
  }
  if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo añadir.");
}

/**
 * Si el botón "Añadir" debe estar deshabilitado: sin nivel elegido, sin
 * traducción al español, o con la petición de esta tarjeta ya en vuelo —esto
 * último evita el doble clic que mandaría dos `POST /api/terms` antes de que
 * `guardadas` se actualice y oculte el botón. Extraída como función pura para
 * poder probarla: el resto del estado de este componente es React puro y no
 * se puede probar sin jsdom, pero esta combinación de condiciones sí.
 */
export function botonAnadirDeshabilitado(
  nivel: string,
  numTraducciones: number,
  enCurso: boolean,
): boolean {
  return !nivel || numTraducciones === 0 || enCurso;
}

export function BuscadorDiccionario() {
  const [consulta, setConsulta] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [niveles, setNiveles] = useState<Record<number, string>>({});
  const [guardadas, setGuardadas] = useState<Set<number>>(new Set());
  // Por acepción, no global: hay varias tarjetas en pantalla a la vez y
  // bloquear todas mientras se guarda una sería peor que el bug que arregla.
  const [guardandoIds, setGuardandoIds] = useState<Set<number>>(new Set());

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!consulta.trim()) return;
    setBuscando(true);
    setError("");
    setGuardadas(new Set());
    try {
      setResultado(await buscarTermino(consulta));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar.");
      setResultado(null);
    } finally {
      setBuscando(false);
    }
  }

  async function anadir(acepcion: Acepcion) {
    // Guarda extra por si el botón llega a pulsarse dos veces antes de que el
    // primer render deshabilitado se pinte: sin esto, dos POST en vuelo a la
    // vez para la misma tarjeta.
    if (guardandoIds.has(acepcion.id)) return;
    setError("");
    setGuardandoIds((previas) => new Set(previas).add(acepcion.id));
    try {
      await anadirAcepcion(acepcion, niveles[acepcion.id] ?? "");
      setGuardadas((previas) => new Set(previas).add(acepcion.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo añadir.");
    } finally {
      setGuardandoIds((previas) => {
        const siguientes = new Set(previas);
        siguientes.delete(acepcion.id);
        return siguientes;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={buscar} className="flex items-end gap-3">
        <Campo
          id="consulta"
          etiqueta="Palabra o expresión"
          value={consulta}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConsulta(e.target.value)}
          className="flex-1"
        />
        <Boton type="submit" disabled={buscando || !consulta.trim()}>
          {buscando ? "Buscando…" : "Buscar"}
        </Boton>
      </form>

      {error && (
        <p role="alert" className="text-peligro">
          {error}
        </p>
      )}

      {resultado && resultado.acepciones.length === 0 && (
        <p className="text-texto-suave">
          <strong className="text-texto">{resultado.termino}</strong> no está en el
          diccionario. Puedes probar con otra forma de la palabra.
        </p>
      )}

      {resultado?.acepciones.map((acepcion) => (
        <Tarjeta key={acepcion.id}>
          <div className="flex flex-col gap-3">
            <p>
              <strong>{acepcion.term}</strong>{" "}
              <span className="text-texto-suave">· {acepcion.pos}</span>
            </p>
            <p>{acepcion.gloss}</p>
            {acepcion.example && <p className="italic text-texto-suave">{acepcion.example}</p>}
            {acepcion.translations.length > 0 ? (
              <p>→ {acepcion.translations.join(", ")}</p>
            ) : (
              <p className="text-texto-suave">Sin traducción al español.</p>
            )}

            {acepcion.yaGuardada || guardadas.has(acepcion.id) ? (
              <p className="text-texto-suave">Ya está en tu repaso.</p>
            ) : (
              <div className="flex items-end gap-3">
                <Campo
                  id={`nivel-${acepcion.id}`}
                  etiqueta="Nivel"
                  value={niveles[acepcion.id] ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setNiveles((previos) => ({ ...previos, [acepcion.id]: e.target.value }))
                  }
                  opciones={[
                    { valor: "", etiqueta: "Elige…" },
                    ...CEFR_LEVELS.map((nivel) => ({ valor: nivel, etiqueta: nivel })),
                  ]}
                />
                <Boton
                  onClick={() => anadir(acepcion)}
                  disabled={botonAnadirDeshabilitado(
                    niveles[acepcion.id] ?? "",
                    acepcion.translations.length,
                    guardandoIds.has(acepcion.id),
                  )}
                >
                  {guardandoIds.has(acepcion.id) ? "Añadiendo…" : "Añadir"}
                </Boton>
              </div>
            )}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}
