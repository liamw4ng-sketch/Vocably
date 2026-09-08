"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { formatearPlazo } from "@/lib/plazo";
import { agruparPorCategoria } from "@/lib/diccionario/categoria";
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

/**
 * Lo que ya está en la biblioteca. `due` llega como texto: la respuesta pasa
 * por JSON y ahí una fecha es una cadena ISO, no un `Date`.
 */
type TerminoGuardado = {
  id: number;
  term: string;
  translation: string;
  level: string;
  senseHint: string;
  due: string;
};

type Resultado = {
  termino: string;
  enBiblioteca: TerminoGuardado[];
  acepciones: Acepcion[];
};

/**
 * Lee el cuerpo de una respuesta sin dar por hecho que es JSON.
 *
 * Cuando el servidor falla de verdad —una tabla que no existe, por ejemplo—
 * Next devuelve un 500 cuyo cuerpo es HTML. Si se llama a `res.json()` a pelo,
 * revienta con el mensaje interno del navegador, que en Safari es "The string
 * did not match the expected pattern.": el usuario ve eso y no puede hacer nada
 * con ello. Devolver `null` deja que cada llamada dé un mensaje suyo.
 */
async function leerCuerpo(res: Response): Promise<{ error?: string } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Qué decirle al usuario cuando el servidor contestó algo ilegible. */
function fallaDelServidor(res: Response, accion: string): Error {
  return new Error(
    `El servidor no pudo ${accion} (error ${res.status}). ` +
      "Si acabas de instalar el diccionario, comprueba que las migraciones están aplicadas.",
  );
}

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
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) throw new Error(cuerpo?.error ?? fallaDelServidor(res, "buscar").message);
  if (!cuerpo) throw fallaDelServidor(res, "buscar");
  return cuerpo as unknown as Resultado;
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
  if (!res.ok) {
    const cuerpo = await leerCuerpo(res);
    throw new Error(cuerpo?.error ?? fallaDelServidor(res, "añadir la palabra").message);
  }
}

/**
 * La traducción que se guarda: manda lo escrito a mano y, si no hay nada
 * escrito, lo que trajo el traductor.
 *
 * Existe porque el traductor gratuito puede caerse o devolver vacío, y sin
 * esto la única salida sería el botón que cuesta dinero. El criterio de la
 * usuaria es que el diccionario funcione gratis; afinar con IA es un extra
 * que se pulsa, no un peaje.
 */
export function acepcionConTraduccion(acepcion: Acepcion, traduccionManual: string): Acepcion {
  const escrita = traduccionManual.trim();
  return escrita ? { ...acepcion, translations: [escrita] } : acepcion;
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
  traduccionManual = "",
): boolean {
  return !nivel || (numTraducciones === 0 && !traduccionManual.trim()) || enCurso;
}

/**
 * Cuándo vuelve a tocar una palabra que ya está en el repaso, con el mismo
 * castellano que los botones de la sesión: se reutiliza `formatearPlazo` en
 * vez de inventar un segundo formato de fecha para la misma idea.
 */
export function cuandoTocaRepasar(due: string, ahora: Date = new Date()): string {
  const fecha = new Date(due);
  if (Number.isNaN(fecha.getTime())) return "sin fecha de repaso";
  const plazo = formatearPlazo(ahora, fecha);
  // `formatearPlazo` dice "ahora" tanto para lo que vence en un minuto como
  // para lo que lleva vencido tres días: en las dos, lo honesto es "toca ya".
  return plazo === "ahora" ? "toca ahora" : `toca en ${plazo}`;
}

/**
 * Qué avisar cuando la búsqueda no trae ninguna acepción. Decir "no está en el
 * diccionario" de una palabra que la usuaria tiene guardada es falso: lo que
 * pasa es que Wikcionario no la trae, no que no la tenga.
 */
export function avisoSinAcepciones(
  numAcepciones: number,
  numEnBiblioteca: number,
): "no-esta" | "solo-en-biblioteca" | null {
  if (numAcepciones > 0) return null;
  return numEnBiblioteca > 0 ? "solo-en-biblioteca" : "no-esta";
}

/**
 * El único punto de esta pantalla que cuesta dinero: pide a Claude una
 * traducción curada para una acepción concreta. Función pura, igual que
 * `buscarTermino` y `anadirAcepcion`, para poder probarla sin jsdom.
 */
export async function afinarConIA(
  entryId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchImpl("/api/diccionario/afinar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
  } catch {
    throw new Error("No se pudo afinar: comprueba la conexión.");
  }
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) throw new Error(cuerpo?.error ?? fallaDelServidor(res, "afinar").message);
  if (!cuerpo) throw fallaDelServidor(res, "afinar");
  return (cuerpo as { translations: string[] }).translations;
}

export function BuscadorDiccionario() {
  const [consulta, setConsulta] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [niveles, setNiveles] = useState<Record<number, string>>({});
  // La traducción escrita a mano, por acepción. Es la salida gratuita cuando
  // el traductor no responde: sin ella, la palabra no se podría añadir salvo
  // pagando por afinar con IA.
  const [traduccionesManuales, setTraduccionesManuales] = useState<Record<number, string>>({});
  const [guardadas, setGuardadas] = useState<Set<number>>(new Set());
  // Por acepción, no global: hay varias tarjetas en pantalla a la vez y
  // bloquear todas mientras se guarda una sería peor que el bug que arregla.
  const [guardandoIds, setGuardandoIds] = useState<Set<number>>(new Set());
  // Mismo patrón que guardandoIds: afinar es la única llamada que cuesta
  // dinero, así que el doble clic que dispararía dos peticiones es aquí el
  // doble de grave.
  const [afinandoIds, setAfinandoIds] = useState<Set<number>>(new Set());

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
      await anadirAcepcion(
        acepcionConTraduccion(acepcion, traduccionesManuales[acepcion.id] ?? ""),
        niveles[acepcion.id] ?? "",
      );
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

  async function afinar(acepcion: Acepcion) {
    if (afinandoIds.has(acepcion.id)) return;
    setError("");
    setAfinandoIds((previas) => new Set(previas).add(acepcion.id));
    try {
      const translations = await afinarConIA(acepcion.id);
      // Sustituye las traducciones de esa ficha en el estado, igual que
      // `anadir` marca la ficha como guardada: sin recargar toda la búsqueda.
      setResultado((previo) =>
        previo
          ? {
              ...previo,
              acepciones: previo.acepciones.map((a) =>
                a.id === acepcion.id ? { ...a, translations } : a,
              ),
            }
          : previo,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo afinar.");
    } finally {
      setAfinandoIds((previas) => {
        const siguientes = new Set(previas);
        siguientes.delete(acepcion.id);
        return siguientes;
      });
    }
  }

  const aviso = resultado
    ? avisoSinAcepciones(resultado.acepciones.length, resultado.enBiblioteca.length)
    : null;

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

      {/* Lo que ya está guardado va primero: si la palabra ya está en el
          repaso, eso es la respuesta a la búsqueda, no las acepciones. */}
      {resultado && resultado.enBiblioteca.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
            Ya en tu repaso
          </h2>
          {resultado.enBiblioteca.map((guardado) => (
            <Tarjeta key={guardado.id}>
              <div className="flex flex-col gap-2">
                <p>
                  <strong>{guardado.term}</strong> → {guardado.translation}
                </p>
                {guardado.senseHint && (
                  <p style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
                    {guardado.senseHint}
                  </p>
                )}
                <p style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
                  {guardado.level} · {cuandoTocaRepasar(guardado.due)}
                </p>
              </div>
            </Tarjeta>
          ))}
        </section>
      )}

      {resultado && aviso === "no-esta" && (
        <p className="text-texto-suave">
          <strong className="text-texto">{resultado.termino}</strong> no está en el
          diccionario. Puedes probar con otra forma de la palabra.
        </p>
      )}

      {resultado && aviso === "solo-en-biblioteca" && (
        <p className="text-texto-suave">
          <strong className="text-texto">{resultado.termino}</strong> no viene en el
          diccionario, pero ya lo tienes guardado.
        </p>
      )}

      {resultado &&
        agruparPorCategoria(resultado.acepciones).map((grupo) => (
          <section key={grupo.pos} className="flex flex-col gap-4">
            {/* La categoría va en el encabezado del grupo y no en cada ficha:
                repetir "sustantivo" en las siete acepciones de `bank` es ruido. */}
            <h2 style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
              {grupo.nombre}
            </h2>
            {grupo.acepciones.map((acepcion) => (
              <Tarjeta key={acepcion.id}>
                <div className="flex flex-col gap-3">
                  <p>
                    <strong>{acepcion.term}</strong>
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
                    <>
                      {/* Afinar solo se ofrece mientras la acepción no está guardada:
                          actualiza la caché del diccionario, no la ficha ya creada en
                          `terms`. Ofrecerlo después sería cobrar por un cambio que la
                          tarjeta de repaso no llegaría a ver. */}
                      <div className="flex flex-col items-start gap-1">
                        <Boton
                          variante="secundario"
                          onClick={() => afinar(acepcion)}
                          disabled={afinandoIds.has(acepcion.id)}
                        >
                          {afinandoIds.has(acepcion.id) ? "Afinando…" : "Afinar con IA"}
                        </Boton>
                        {/* El usuario tiene que saber que esto cuesta dinero antes de pulsar:
                            es el único punto de pago de toda la pantalla. */}
                        <p style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
                          Afinar cuesta unos céntimos. Todo lo demás de esta pantalla es gratis.
                        </p>
                      </div>

                      <Campo
                        id={`traduccion-${acepcion.id}`}
                        etiqueta="Traducción a mano"
                        value={traduccionesManuales[acepcion.id] ?? ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setTraduccionesManuales((previas) => ({
                            ...previas,
                            [acepcion.id]: e.target.value,
                          }))
                        }
                        ayuda="Si escribes algo aquí, se guarda esto en vez de la traducción de arriba."
                      />

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
                            traduccionesManuales[acepcion.id] ?? "",
                          )}
                        >
                          {guardandoIds.has(acepcion.id) ? "Añadiendo…" : "Añadir"}
                        </Boton>
                      </div>
                    </>
                  )}
                </div>
              </Tarjeta>
            ))}
          </section>
        ))}
    </div>
  );
}
