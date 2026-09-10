"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { formatearPlazo } from "@/lib/plazo";
import { agruparPorCategoria } from "@/lib/diccionario/categoria";
import { traduccionesPosibles } from "@/lib/diccionario/traducciones-posibles";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

export type Acepcion = {
  id: number;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
  yaGuardada: boolean;
};

/** Un grupo de significados en español de la palabra, por categoría gramatical. */
export type GrupoDeSignificados = {
  pos: string;
  nombre: string;
  meanings: string[];
  source: string;
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
  significados: GrupoDeSignificados[];
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
  traduccion: string,
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
      body: JSON.stringify(entradaParaGuardar(acepcion, traduccion, nivel)),
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
 * La tarjeta que entra en la biblioteca con lo que el usuario ha elegido.
 *
 * `gloss` es el significado inglés elegido, y es **lo único que distingue dos
 * acepciones de la misma palabra**: `bank`→orilla de `bank`→banco. Se guarda
 * como `senseHint` y es media clave de deduplicación de la biblioteca.
 */
export function entradaParaGuardar(
  acepcion: Acepcion,
  traduccion: string,
  nivel: string,
): {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translation: string;
  level: string;
} {
  return {
    term: acepcion.term,
    pos: acepcion.pos,
    gloss: acepcion.gloss,
    example: acepcion.example,
    translation: traduccion.trim(),
    level: nivel,
  };
}

/**
 * Las tres elecciones son obligatorias: significado, traducción y nivel. Sin
 * cualquiera de ellas no hay tarjeta que guardar, y guardarla a medias
 * produciría un reverso en blanco o una acepción sin distinguir.
 *
 * `enCurso` evita el doble toque que mandaría dos `POST /api/terms` antes de que
 * la pantalla se entere del primero.
 */
export function botonAnadirDeshabilitado(
  acepcion: Acepcion | null,
  traduccion: string,
  nivel: string,
  enCurso: boolean,
): boolean {
  return !acepcion || !traduccion.trim() || !nivel || enCurso;
}

/**
 * Afinar pide a Claude una traducción curada de **una acepción concreta**, así
 * que sin significado elegido no hay nada que afinar. Es el único botón de toda
 * la aplicación que cuesta dinero, y por eso también se bloquea mientras su
 * petición está en vuelo.
 */
export function botonAfinarDeshabilitado(acepcion: Acepcion | null, enCurso: boolean): boolean {
  return !acepcion || enCurso;
}

/**
 * La lista de traducciones tras afinar. Lo afinado va **al principio**: es lo
 * único que costó dinero y lo único curado para la acepción concreta que el
 * usuario eligió, así que es la mejor opción que hay.
 *
 * Lo que ya estaba en `lista` se deja tal cual —ni cambia de forma ni de
 * sitio—: solo se antepone lo afinado que sea genuinamente nuevo. La frontera
 * entre lo que ya estaba y lo nuevo **se calcula, no se supone**:
 * `traduccionesPosibles` también recorta, descarta vacíos y deduplica
 * *dentro* de un mismo grupo, así que `lista` puede sobrevivir con menos
 * elementos de los que trae. Cortar a ciegas en `lista.length` se comería
 * traducciones afinadas de verdad — `traduccionesPosibles(["banco","Banco"],
 * ["orilla"])` perdería "orilla", que es lo único que costó dinero.
 * `yaEstaban` mide cuánto sobrevive de `lista` sola, y esa medida, no
 * `lista.length`, es la que marca dónde empieza lo nuevo.
 *
 * Reutiliza `traduccionesPosibles` para no repetir la regla de deduplicación:
 * si un día cambia cómo se comparan dos traducciones, cambia en un solo sitio.
 */
export function conTraduccionesAfinadas(lista: string[], afinadas: string[]): string[] {
  const yaEstaban = traduccionesPosibles([lista], []);
  const nuevas = traduccionesPosibles([lista], [afinadas]).slice(yaEstaban.length);
  return [...nuevas, ...lista];
}

/**
 * Qué traducción queda seleccionada tras afinar. **No es `afinadas[0]` a
 * secas**: lo que devuelve la IA puede coincidir, salvo mayúsculas o
 * espacios, con una traducción que ya estaba en `lista`, y entonces
 * `conTraduccionesAfinadas` conserva la forma vieja, no la de la IA —es su
 * regla de "se enseña la primera forma que apareció". Seleccionar la forma
 * de la IA en ese caso no casaría con ningún `t` de la lista pintada: la
 * pantalla se quedaría sin ningún radio marcado y aun así dejaría añadir.
 *
 * Por eso se selecciona **la forma que sobrevive en la lista ya fundida**,
 * no la que llegó de la IA.
 */
export function traduccionSeleccionadaTrasAfinar(lista: string[], afinadas: string[]): string {
  return conTraduccionesAfinadas(lista, afinadas)[0] ?? "";
}

/** Un significado ya numerado para pintar en el `<ol>`, con si se puede elegir. */
export type SignificadoNumerado = {
  numero: number;
  acepcion: Acepcion;
  elegible: boolean;
};

/**
 * Numera los significados desde 1, en el orden en que llegan —guardados
 * incluidos—, y dice cuáles se pueden elegir.
 *
 * Esconder los ya guardados cambiaría la numeración entre visitas y haría
 * imposible referirse a «el tercero» (§7), así que se numeran en su sitio y
 * salen como no elegibles, no se quitan de la lista.
 */
export function significadosNumerados(acepciones: Acepcion[]): SignificadoNumerado[] {
  return acepciones.map((acepcion, indice) => ({
    numero: indice + 1,
    acepcion,
    elegible: !acepcion.yaGuardada,
  }));
}

/**
 * Si esta opción de la lista de traducciones es la que está marcada ahora
 * mismo. Escribir algo a mano manda sobre lo elegido de la lista —es la
 * forma de seleccionarlo—, así que mientras haya algo escrito ninguna
 * opción de la lista está marcada, aunque su texto coincida por casualidad
 * con lo escrito a mano. Un manual que solo tiene espacios no cuenta como
 * escrito.
 *
 * Sirve a los dos sitios que antes calculaban esto por separado y en
 * paralelo —qué radio se pinta marcado, y qué traducción viaja al
 * guardar—: que sea la misma función evita que puedan separarse sin
 * querer, que es exactamente el fallo que arregló 477e90c (una traducción
 * guardada sin que ningún radio estuviera marcado).
 */
export function traduccionMarcada(opcion: string, elegida: string, manual: string): boolean {
  return !manual.trim() && opcion === elegida;
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

const TEXTO_1 = { fontSize: "var(--tamano-1)" };

export function BuscadorDiccionario() {
  const [consulta, setConsulta] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  // Las tres elecciones del usuario, más lo escrito a mano: una sola palabra
  // en pantalla a la vez, así que basta un valor de cada, no un registro por
  // acepción como antes.
  const [acepcionElegida, setAcepcionElegida] = useState<Acepcion | null>(null);
  const [traduccionElegida, setTraduccionElegida] = useState("");
  const [manual, setManual] = useState("");
  const [nivel, setNivel] = useState("");
  // Lo que ha devuelto "Afinar con IA" en esta búsqueda: se antepone a la
  // lista de traducciones con `conTraduccionesAfinadas`.
  const [afinadas, setAfinadas] = useState<string[]>([]);
  // Set en vez de booleano por costumbre del fichero: nunca hay más de un id
  // dentro a la vez, porque solo hay una tarjeta en pantalla, pero así la
  // petición en vuelo se sigue mirando por el id de la acepción concreta.
  const [guardandoIds, setGuardandoIds] = useState<Set<number>>(new Set());
  const [afinandoIds, setAfinandoIds] = useState<Set<number>>(new Set());

  // La lista sin fundir con lo afinado: la necesita `afinar()` para calcular
  // qué queda seleccionado con `traduccionSeleccionadaTrasAfinar`. Declarada
  // aquí arriba, antes de `afinar()`, no donde se usa por última vez: si
  // este cálculo se metiera algún día en un `useMemo`, depender de un
  // `const` declarado más abajo en el cuerpo del componente rompería en
  // silencio por orden de evaluación.
  const traduccionesBase = resultado
    ? traduccionesPosibles(
        resultado.acepciones.map((a) => a.translations),
        resultado.significados.map((g) => g.meanings),
      )
    : [];

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!consulta.trim()) return;
    setBuscando(true);
    setError("");
    // Una búsqueda nueva no puede arrastrar la elección de la palabra
    // anterior: guardaría la traducción de otra palabra.
    setAcepcionElegida(null);
    setTraduccionElegida("");
    setManual("");
    setNivel("");
    setAfinadas([]);
    try {
      setResultado(await buscarTermino(consulta));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar.");
      setResultado(null);
    } finally {
      setBuscando(false);
    }
  }

  async function anadir() {
    if (!acepcionElegida) return;
    // Guarda extra por si el botón llega a pulsarse dos veces antes de que el
    // primer render deshabilitado se pinte: sin esto, dos POST en vuelo a la
    // vez para la misma tarjeta.
    if (guardandoIds.has(acepcionElegida.id)) return;
    setError("");
    setGuardandoIds((previas) => new Set(previas).add(acepcionElegida.id));
    try {
      await anadirAcepcion(acepcionElegida, nivel, traduccion);
      // Marca esa acepción como guardada en el propio resultado, igual que
      // `afinar` sustituye sus traducciones: sin volver a buscar.
      setResultado((previo) =>
        previo
          ? {
              ...previo,
              acepciones: previo.acepciones.map((a) =>
                a.id === acepcionElegida.id ? { ...a, yaGuardada: true } : a,
              ),
            }
          : previo,
      );
      // El nivel no se limpia aquí: la regla de limpieza es para la
      // búsqueda nueva, no para haber añadido un sentido de la misma
      // palabra. Limpiarlo obligaría a reelegirlo para cada acepción de
      // `bank`, que es justo el flujo que esta pantalla existe para permitir.
      setAcepcionElegida(null);
      setTraduccionElegida("");
      setManual("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo añadir.");
    } finally {
      setGuardandoIds((previas) => {
        const siguientes = new Set(previas);
        siguientes.delete(acepcionElegida.id);
        return siguientes;
      });
    }
  }

  async function afinar() {
    if (!acepcionElegida) return;
    if (afinandoIds.has(acepcionElegida.id)) return;
    setError("");
    setAfinandoIds((previas) => new Set(previas).add(acepcionElegida.id));
    try {
      const translations = await afinarConIA(acepcionElegida.id);
      // Se antepone a lo afinado antes, y la forma que sobrevive en la lista
      // ya fundida queda seleccionada —no la que devolvió la IA a secas—:
      // si coincide con una traducción que ya estaba, la lista conserva la
      // forma vieja, y seleccionar la de la IA dejaría la pantalla sin
      // ningún radio marcado.
      const siguientesAfinadas = [...translations, ...afinadas];
      setAfinadas(siguientesAfinadas);
      setTraduccionElegida(traduccionSeleccionadaTrasAfinar(traduccionesBase, siguientesAfinadas));
      setManual("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo afinar.");
    } finally {
      setAfinandoIds((previas) => {
        const siguientes = new Set(previas);
        siguientes.delete(acepcionElegida.id);
        return siguientes;
      });
    }
  }

  const aviso = resultado
    ? avisoSinAcepciones(resultado.acepciones.length, resultado.enBiblioteca.length)
    : null;

  // Todas las traducciones al español en una sola lista: las de las
  // acepciones y las de la palabra, sin repetidos, con lo afinado delante.
  const traducciones = conTraduccionesAfinadas(traduccionesBase, afinadas);

  // Las categorías gramaticales de las acepciones, sin repetir: la cabecera
  // de la tarjeta pierde el origen de cada traducción (§10 lo acepta), pero
  // no la categoría.
  const categorias = resultado ? agruparPorCategoria(resultado.acepciones).map((g) => g.nombre) : [];

  // La forma que trae el diccionario, no la que escribió el usuario:
  // `buscarEnDiccionario` busca por variantes del lema, así que pueden no
  // coincidir ("bite off more than you can chew" buscado, pero el
  // diccionario guarda "bite off more than one can chew"; "Bank" buscado,
  // "bank" guardado). Todas las acepciones comparten el mismo `term`, porque
  // vienen de una sola búsqueda por un único `termNormalized`.
  const terminoDelDiccionario =
    resultado && resultado.acepciones.length > 0 ? resultado.acepciones[0].term : "";

  // Lo que se guarda es la misma traducción que se ve marcada en la lista, o
  // lo escrito a mano si hay algo: `traduccionMarcada` decide las dos cosas
  // con la misma regla, así que no pueden desalinearse.
  const opcionMarcada = traducciones.find((t) => traduccionMarcada(t, traduccionElegida, manual));
  const traduccion = manual.trim() || opcionMarcada || "";

  // Si hay una petición en vuelo para la acepción elegida: cada una hace
  // falta dos veces (deshabilitar su botón, cambiar su texto), así que se
  // calcula una sola vez.
  const afinandoEstaAcepcion = acepcionElegida ? afinandoIds.has(acepcionElegida.id) : false;
  const guardandoEstaAcepcion = acepcionElegida ? guardandoIds.has(acepcionElegida.id) : false;

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

      {/* Una sola tarjeta por palabra: el usuario elige significado,
          traducción y nivel aquí dentro, y esos tres son los únicos estados
          nuevos que hacen falta. */}
      {resultado && resultado.acepciones.length > 0 && (
        <Tarjeta>
          <div className="flex flex-col gap-4">
            {/* La cabecera: la forma que trae el diccionario —no la que
                escribió el usuario, que puede ser otra variante del lema o
                venir en otras mayúsculas— y las categorías gramaticales de
                sus acepciones, sin repetir. */}
            <div className="flex items-baseline justify-between gap-3">
              <p>
                <strong className="text-texto">{terminoDelDiccionario}</strong>
              </p>
              {categorias.length > 0 && (
                <p style={TEXTO_1} className="text-texto-suave">
                  {categorias.join(" · ")}
                </p>
              )}
            </div>

            {/* Las traducciones: una lista de opciones, y siempre la de escribir otra.
                El usuario pidió elegir él, así que ninguna viene marcada de entrada. */}
            {traducciones.length === 0 ? (
              <p className="text-texto-suave">No hay ninguna traducción de ningún origen.</p>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend style={TEXTO_1} className="text-texto-suave">
                  Traducciones al español
                </legend>
                {traducciones.map((t) => (
                  <label key={t} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="traduccion"
                      checked={traduccionMarcada(t, traduccionElegida, manual)}
                      onChange={() => {
                        setTraduccionElegida(t);
                        setManual("");
                      }}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {/* Escribir otra va fuera del fieldset de radios: es un campo con su propia
                etiqueta, y anidar un input dentro de un label de radio rompe el foco. */}
            <Campo
              id="traduccion-a-mano"
              etiqueta="…o escribe otra"
              value={manual}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setManual(e.target.value);
                if (e.target.value.trim()) setTraduccionElegida("");
              }}
              ayuda="Si escribes algo aquí, se guarda esto en vez de la traducción elegida arriba."
            />

            {/* Los significados, numerados desde 1. Los ya guardados se enseñan igual y en
                su sitio —esconderlos cambiaría la numeración entre visitas— pero sin radio. */}
            <fieldset className="flex flex-col gap-2">
              <legend style={TEXTO_1} className="text-texto-suave">
                Significados
              </legend>
              <ol className="flex list-none flex-col gap-3">
                {significadosNumerados(resultado.acepciones).map((s) => (
                  <li key={s.acepcion.id}>
                    {s.elegible ? (
                      // Dentro de un `<label>`, como el bloque de traducciones: sin él, en
                      // el móvil solo se acierta en el círculo de ~16px del radio.
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="significado"
                          checked={acepcionElegida?.id === s.acepcion.id}
                          onChange={() => setAcepcionElegida(s.acepcion)}
                        />
                        <div className="flex flex-col gap-1">
                          <p>
                            {s.numero}. {s.acepcion.gloss}
                          </p>
                          {s.acepcion.example && (
                            <p className="italic text-texto-suave">{s.acepcion.example}</p>
                          )}
                        </div>
                      </label>
                    ) : (
                      // Sin radio que etiquetar: no lleva `label`.
                      <div className="flex items-start gap-2">
                        <span aria-hidden className="w-4" />
                        <div className="flex flex-col gap-1">
                          <p>
                            {s.numero}. {s.acepcion.gloss}
                          </p>
                          {s.acepcion.example && (
                            <p className="italic text-texto-suave">{s.acepcion.example}</p>
                          )}
                          <p style={TEXTO_1} className="text-texto-suave">
                            Ya está en tu repaso.
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </fieldset>

            <div className="flex items-end gap-3">
              <Campo
                id="nivel"
                etiqueta="Nivel"
                value={nivel}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNivel(e.target.value)}
                opciones={[
                  { valor: "", etiqueta: "Elige…" },
                  ...CEFR_LEVELS.map((n) => ({ valor: n, etiqueta: n })),
                ]}
              />
              <Boton
                onClick={anadir}
                disabled={botonAnadirDeshabilitado(
                  acepcionElegida,
                  traduccion,
                  nivel,
                  guardandoEstaAcepcion,
                )}
              >
                {guardandoEstaAcepcion ? "Añadiendo…" : "Añadir"}
              </Boton>
            </div>

            {/* Afinar con IA va el último, debajo de Nivel/Añadir (§4): solo mira
                el significado elegido —es la traducción curada de esa acepción
                concreta— y es el único punto de pago de la pantalla. */}
            <div className="flex flex-col items-start gap-1">
              <Boton
                variante="secundario"
                onClick={afinar}
                disabled={botonAfinarDeshabilitado(acepcionElegida, afinandoEstaAcepcion)}
              >
                {afinandoEstaAcepcion ? "Afinando…" : "Afinar con IA"}
              </Boton>
              <p style={TEXTO_1} className="text-texto-suave">
                Afinar cuesta unos céntimos. Todo lo demás de esta pantalla es gratis.
              </p>
            </div>
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
