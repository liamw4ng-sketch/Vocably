"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartaCola, Cola, ResumenColecciones } from "@/db/repository/review";
import {
  MODOS,
  MODO_POR_DEFECTO,
  TOPE_MAXIMO_TARJETAS_NUEVAS,
  MAXIMO_TAMANO_SESION,
  esModo,
  type Modo,
} from "@/lib/ajustes";
import { crearSesion, type EnvioRespuesta, type Sesion, type Valoracion } from "@/lib/review-session";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

/** "antes" es la pantalla previa: se elige qué y cuánto repasar y solo
 * entonces se pide la cola. */
type Estado = "cargando" | "error" | "antes" | "lista";

type BotonValoracion = {
  valor: Valoracion;
  etiqueta: string;
  campo: "otraVez" | "dificil" | "bien" | "facil";
  clase: string;
};

/** Los cuatro botones, en el orden de las teclas 1-4 y con los colores del sistema. */
const VALORACIONES: BotonValoracion[] = [
  { valor: 1, etiqueta: "Otra vez", campo: "otraVez", clase: "bg-valoracion-otra-vez" },
  { valor: 2, etiqueta: "Difícil", campo: "dificil", clase: "bg-valoracion-dificil" },
  { valor: 3, etiqueta: "Bien", campo: "bien", clase: "bg-valoracion-bien" },
  { valor: 4, etiqueta: "Fácil", campo: "facil", clase: "bg-valoracion-facil" },
];

const ETIQUETA_TIPO: Record<string, string> = {
  word: "palabra",
  phrasal_verb: "verbo frasal",
  expression: "expresión",
};

/** El resalte del término: --acento al 15%, sin inventar ningún color nuevo. */
const FONDO_RESALTE = "color-mix(in srgb, var(--acento) 15%, transparent)";

const TEXTO_1 = { fontSize: "var(--tamano-1)" };
const TEXTO_2 = { fontSize: "var(--tamano-2)" };
const TEXTO_3 = { fontSize: "var(--tamano-3)" };
const TEXTO_4 = { fontSize: "var(--tamano-4)" };
const TEXTO_5 = { fontSize: "var(--tamano-5)" };
const TEXTO_6 = { fontSize: "var(--tamano-6)" };

/** Los contadores de la pantalla previa. No construye la cola. */
async function pedirResumen(): Promise<ResumenColecciones> {
  const respuesta = await fetch("/api/repaso/resumen");
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return (await respuesta.json()) as ResumenColecciones;
}

/** Pide la cola ya elegida. Sin estado de React dentro: solo red. */
async function pedirCola(modo: Modo, cuantas: number): Promise<Cola> {
  const respuesta = await fetch(`/api/repaso/cola?modo=${modo}&cuantas=${cuantas}`);
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return (await respuesta.json()) as Cola;
}

/** El cuerpo del POST es exactamente lo que pide la ruta: tres campos, sin fecha ni estado. */
async function enviarRespuesta(envio: EnvioRespuesta): Promise<unknown> {
  const respuesta = await fetch("/api/repaso/respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envio),
  });
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return respuesta.json();
}

/** Los dos ajustes numéricos que guarda el servidor. `newCardsPerDay` se
 * guarda al salir del campo; `sessionSize`, solo al empezar y con "Recordar
 * esta elección" marcada. */
export type CampoAjuste = "newCardsPerDay" | "sessionSize";
type Ajustes = Record<CampoAjuste, number> & { sessionMode: Modo };

async function pedirAjustes(): Promise<Ajustes> {
  const respuesta = await fetch("/api/ajustes");
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return (await respuesta.json()) as Ajustes;
}

/** Devuelve el valor guardado, o un mensaje de error en español si el servidor
 * lo rechazó o si la petición ni siquiera pudo hacerse (sin conexión, DNS,
 * servidor caído): en ese caso `fetch` lanza, y sin capturarlo aquí la
 * llamante se quedaría con el `await` colgado para siempre. */
export async function guardarAjuste(
  campo: CampoAjuste,
  valor: number,
): Promise<{ valor: number } | { error: string }> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/ajustes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
  } catch {
    return { error: "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo otra vez." };
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as
    | (Partial<Ajustes> & { error?: string })
    | null;
  if (!respuesta.ok) {
    return { error: cuerpo?.error ?? "No se pudo guardar el cambio." };
  }
  return { valor: cuerpo?.[campo] ?? valor };
}

/**
 * Guardar el modo es igual que guardar un número, pero el valor no es numérico
 * y `guardarAjuste` valida y revierte pensando en enteros.
 */
async function guardarModo(modo: Modo): Promise<{ error: string } | null> {
  try {
    const respuesta = await fetch("/api/ajustes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionMode: modo }),
    });
    if (!respuesta.ok) return { error: "No se pudo guardar el modo." };
  } catch {
    return { error: "No se pudo conectar con el servidor." };
  }
  return null;
}

/**
 * Un ajuste numérico que se guarda al salir del campo: borrador, validación en
 * el cliente, guardado y vuelta al último valor bueno si el servidor lo
 * rechaza. Hoy lo usa solo el tope diario; "Cuántas" no pasa por aquí porque
 * no es un ajuste permanente, sino la elección de una sesión (§4 del diseño).
 *
 * No pide su propio valor al servidor: los ajustes llegan todos en la misma
 * respuesta y quien monta la pantalla los reparte con `fijar`.
 */
function useAjusteNumerico(
  campo: CampoAjuste,
  maximo: number,
  montadoRef: { current: boolean },
) {
  const [valor, setValor] = useState<number | null>(null);
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const fijar = useCallback((nuevo: number) => {
    setValor(nuevo);
    setBorrador(String(nuevo));
  }, []);

  /** Se llama al salir del campo. Valida en el cliente para no esperar a la
   * red con un valor obviamente malo, pero el servidor sigue siendo quien
   * decide: si lo rechaza, el campo vuelve al último valor guardado y enseña
   * el motivo. */
  const confirmar = useCallback(async () => {
    const texto = borrador.trim();
    const numero = Number(texto);
    if (texto === "" || !Number.isInteger(numero) || numero < 0 || numero > maximo) {
      setError(`Debe ser un número entero entre 0 y ${maximo}.`);
      return;
    }
    if (numero === valor) {
      setError("");
      return;
    }

    setGuardando(true);
    setError("");
    try {
      const resultado = await guardarAjuste(campo, numero);
      if (!montadoRef.current) return;
      if ("error" in resultado) {
        setError(resultado.error);
        setBorrador(String(valor ?? numero));
        return;
      }
      setValor(resultado.valor);
      setBorrador(String(resultado.valor));
    } finally {
      // `finally` en vez de un `setGuardando(false)` tras el `await`: así el
      // campo se reactiva pase lo que pase, incluso si `guardarAjuste` (u otra
      // cosa inesperada) llegara a lanzar. Antes, un `fetch` que lanzaba
      // dejaba el campo deshabilitado para siempre.
      if (montadoRef.current) setGuardando(false);
    }
  }, [borrador, valor, campo, maximo, montadoRef]);

  return { valor, borrador, setBorrador, error, guardando, fijar, confirmar };
}

type Trozo = { texto: string; resaltado: boolean };

/**
 * Parte una frase para poder resaltar el término dentro de ella. La búsqueda
 * ignora mayúsculas; si el término no aparece tal cual (en la frase está
 * conjugado, por ejemplo), la frase se muestra entera sin resaltar.
 */
function partirPorTermino(frase: string, termino: string): Trozo[] {
  const aguja = termino.trim().toLowerCase();
  if (!aguja) return [{ texto: frase, resaltado: false }];

  const pajar = frase.toLowerCase();
  const trozos: Trozo[] = [];
  let desde = 0;
  for (;;) {
    const encontrado = pajar.indexOf(aguja, desde);
    if (encontrado === -1) break;
    if (encontrado > desde) {
      trozos.push({ texto: frase.slice(desde, encontrado), resaltado: false });
    }
    trozos.push({ texto: frase.slice(encontrado, encontrado + aguja.length), resaltado: true });
    desde = encontrado + aguja.length;
  }
  if (desde < frase.length) trozos.push({ texto: frase.slice(desde), resaltado: false });
  return trozos;
}

/**
 * Si la frase de contexto aporta algo por encima de la pista.
 *
 * Lo añadido desde el diccionario guarda la misma glosa inglesa en las dos: no
 * hay libro detrás del que sacar una frase, así que el contexto más honesto es
 * el significado. Pintarla dos veces —recortada a una línea arriba y entera y
 * más grande justo debajo— anula el motivo de recortarla. Se compara al
 * mostrar, no al guardar, para que también arregle las fichas ya creadas.
 */
export function mostrarContexto(context: string, senseHint: string): boolean {
  const frase = context.trim();
  if (!frase) return false;
  return frase !== senseHint.trim();
}

export const ETIQUETA_MODO: Record<Modo, string> = {
  "no-aprendidas": "No aprendidas",
  aprendidas: "Aprendidas",
  mezcla: "Mezcla",
};

/**
 * Cuántas tarjetas hay para un modo. Con el número a 0 solo cuenta lo vencido,
 * porque eso es lo único que entraría; con un número explícito cuenta también
 * lo adelantable, que es de donde saldría el resto.
 */
export function disponibles(
  resumen: ResumenColecciones,
  modo: Modo,
  cuantas: number,
): number {
  const lado = cuantas === 0 ? resumen.hoy : resumen.total;
  if (modo === "no-aprendidas") return lado.sinAprender;
  if (modo === "aprendidas") return lado.aprendidas;
  return lado.sinAprender + lado.aprendidas;
}

/** Un modo vacío tiene que salir desactivado, no fallar al pulsarlo. */
export function puedeEmpezar(
  resumen: ResumenColecciones,
  modo: Modo,
  cuantas: number,
): boolean {
  return disponibles(resumen, modo, cuantas) > 0;
}

/**
 * Lo tecleado en "Cuántas", ya validado. Es la misma comprobación que hace
 * `useAjusteNumerico` antes de guardar, pero suelta: "Cuántas" no se guarda al
 * salir del campo —vale solo para esta sesión salvo que se marque la casilla—
 * y aun así un número imposible tiene que explicarse y no dejar empezar.
 */
export function validarCuantas(texto: string): { valor: number } | { error: string } {
  const limpio = texto.trim();
  const numero = Number(limpio);
  if (
    limpio === "" ||
    !Number.isInteger(numero) ||
    numero < 0 ||
    numero > MAXIMO_TAMANO_SESION
  ) {
    return { error: `Debe ser un número entero entre 0 y ${MAXIMO_TAMANO_SESION}.` };
  }
  return { valor: numero };
}

function Frase({
  frase,
  termino,
  className,
  style,
}: {
  frase: string;
  termino: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <p className={className} style={style}>
      {partirPorTermino(frase, termino).map((trozo, indice) =>
        trozo.resaltado ? (
          <mark
            key={indice}
            className="rounded-control px-1 font-semibold text-texto"
            style={{ backgroundColor: FONDO_RESALTE }}
          >
            {trozo.texto}
          </mark>
        ) : (
          <span key={indice}>{trozo.texto}</span>
        ),
      )}
    </p>
  );
}

function LineaMeta({ carta }: { carta: CartaCola }) {
  const partes = [carta.level, ETIQUETA_TIPO[carta.type] ?? carta.type];
  if (carta.esNueva) partes.push("nueva");
  return (
    <p style={TEXTO_1} className="text-texto-suave">
      {partes.join(" · ")}
    </p>
  );
}

export function SesionRepaso() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("cargando");
  const [cartas, setCartas] = useState<CartaCola[]>([]);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [revelada, setRevelada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // `Sesion` es un objeto mutable sin React dentro: hay que pedir el redibujo.
  const [, redibujar] = useReducer((n: number) => n + 1, 0);

  // Lo elegido en la pantalla previa. Modo y número salen de los ajustes
  // guardados al cargar, pero desde ahí son elección de esta sesión: no se
  // guardan salvo que "Recordar esta elección" esté marcada al empezar.
  const [resumen, setResumen] = useState<ResumenColecciones | null>(null);
  const [modo, setModo] = useState<Modo>(MODO_POR_DEFECTO);
  const [cuantasBorrador, setCuantasBorrador] = useState("");
  const [cuantasError, setCuantasError] = useState("");
  const [recordar, setRecordar] = useState(false);
  const [empezando, setEmpezando] = useState(false);

  // Se valida en cada render, no al salir del campo: así lo que se pide es
  // siempre lo que se está viendo. Con un valor imposible se usa 0 para los
  // contadores, pero "Empezar" queda desactivado y no llega a pedirse nada.
  const cuantasValidado = validarCuantas(cuantasBorrador);
  const cuantasVale = "valor" in cuantasValidado;
  const cuantas = "valor" in cuantasValidado ? cuantasValidado.valor : 0;

  // Repasos vencidos hoy que esta sesión dejó fuera, sea por el número pedido o
  // por el modo. Se lee al pedir la cola y se enseña al terminar: sin esto, una
  // sesión por debajo del ritmo diario acumula atrasos sin que nada lo diga.
  const [repasosFuera, setRepasosFuera] = useState(0);

  // Se lee dentro de callbacks async (valorar) para no tocar estado tras
  // desmontar, igual que el guard `cancelado` del efecto de carga inicial de
  // abajo, pero aquí como ref porque el disparador es un evento, no un efecto.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // El tope diario sí es un ajuste permanente: se guarda al salir del campo,
  // como siempre. Ya no hacen falta ni un `ajustesCargaFallo` ni un ref de "ya
  // lo he pedido": los ajustes llegan en la carga inicial, y si esa falla,
  // falla la pantalla entera y hay un botón para reintentarla.
  const topeNuevas = useAjusteNumerico("newCardsPerDay", TOPE_MAXIMO_TARJETAS_NUEVAS, montadoRef);

  // Carga inicial: función async dentro del efecto con su guard, igual que en
  // TermTable, para no encadenar renders desde el cuerpo del efecto. No pide la
  // cola: qué cola pedir se decide en la pantalla previa.
  useEffect(() => {
    let cancelado = false;

    async function cargarInicial() {
      try {
        const [datos, ajustes] = await Promise.all([pedirResumen(), pedirAjustes()]);
        if (cancelado) return;
        setResumen(datos);
        // El servidor ya devuelve un modo válido, pero lo que llega por la red
        // es JSON sin comprobar: un valor viejo dejaría los tres botones sin
        // marcar y no habría manera de saber qué se iba a repasar.
        setModo(esModo(ajustes.sessionMode) ? ajustes.sessionMode : MODO_POR_DEFECTO);
        topeNuevas.fijar(ajustes.newCardsPerDay);
        // El número guardado solo siembra el campo: a partir de aquí vive en
        // el borrador y no vuelve al servidor si no se marca la casilla.
        setCuantasBorrador(String(ajustes.sessionSize));
        setEstado("antes");
      } catch {
        if (!cancelado) setEstado("error");
      }
    }

    void cargarInicial();
    return () => {
      cancelado = true;
    };
    // `fijar` es estable (useCallback sin dependencias) y esto se hace una sola
    // vez, al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Vuelve a la pantalla previa con los contadores al día. Sirve para las dos
   * cosas que llevan al mismo sitio: reintentar cuando la carga falló —el
   * error ocurre antes de que exista ninguna cola, así que lo que hay que
   * volver a pedir es el resumen— y volver a elegir al terminar una sesión.
   */
  const recargar = useCallback(async () => {
    setSesion(null);
    setEstado("cargando");
    try {
      const datos = await pedirResumen();
      if (!montadoRef.current) return;
      setResumen(datos);
      setEstado("antes");
    } catch {
      if (montadoRef.current) setEstado("error");
    }
  }, []);

  /**
   * Los contadores otra vez, sin vaciar la pantalla: se usa al cambiar el tope
   * diario, que es de lo que depende cuántas palabras nuevas entran hoy. Si
   * falla se quedan los de antes; no vale la pena tirar abajo la pantalla
   * entera por un recuento.
   */
  const refrescarResumen = useCallback(async () => {
    try {
      const datos = await pedirResumen();
      if (montadoRef.current) setResumen(datos);
    } catch {
      // Los contadores anteriores siguen en pantalla.
    }
  }, []);

  /** Arranca la sesión con lo elegido: aquí, y solo aquí, se pide la cola. */
  const empezar = useCallback(async () => {
    setEmpezando(true);
    try {
      // Aquí, y solo aquí, se guardan modo y número: sin la casilla marcada la
      // elección vale para esta sesión y nada más. Se guarda ANTES de pedir la
      // cola: si la cola falla, la preferencia ya quedó guardada, que es lo que
      // el usuario pidió al marcarla.
      if (recordar) {
        await guardarAjuste("sessionSize", cuantas);
        await guardarModo(modo);
      }
      const cola = await pedirCola(modo, cuantas);
      if (!montadoRef.current) return;
      setCartas(cola.cartas);
      setRepasosFuera(cola.repasosFuera);
      setSesion(crearSesion(cola.cartas, { enviar: enviarRespuesta }));
      setRevelada(false);
      setGuardando(false);
      setEstado("lista");
    } catch {
      if (montadoRef.current) setEstado("error");
    } finally {
      if (montadoRef.current) setEmpezando(false);
    }
  }, [modo, recordar, cuantas]);

  const revelar = useCallback(() => setRevelada(true), []);

  const valorar = useCallback(
    (valor: Valoracion) => {
      if (!sesion || !revelada || !sesion.cartaActual()) return;
      // Sin esto, una barra espaciadora posterior volvería a pulsar el botón
      // que quedó con el foco y valoraría la siguiente tarjeta sin querer.
      (document.activeElement as HTMLElement | null)?.blur();

      sesion.responder(valor);
      setRevelada(false);
      redibujar();

      if (!sesion.cartaActual()) {
        setGuardando(true);
        void sesion.pendientes().then(() => {
          if (!montadoRef.current) return;
          setGuardando(false);
          redibujar();
        });
      }
    },
    [sesion, revelada],
  );

  useEffect(() => {
    function alPulsar(evento: KeyboardEvent) {
      if (evento.repeat || evento.metaKey || evento.ctrlKey || evento.altKey) return;
      // Si el foco está en un control, mandan sus propias teclas.
      const destino = evento.target as HTMLElement | null;
      if (destino?.closest?.("button, a, input, select, textarea, [role='button']")) return;

      if (evento.key === " " || evento.code === "Space") {
        evento.preventDefault();
        revelar();
        return;
      }
      const valor = Number(evento.key);
      if (valor === 1 || valor === 2 || valor === 3 || valor === 4) {
        evento.preventDefault();
        valorar(valor);
      }
    }
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [revelar, valorar]);

  if (estado === "cargando") {
    return (
      <p style={TEXTO_2} className="text-texto-suave">
        Cargando el repaso…
      </p>
    );
  }

  // La pantalla previa: sustituye a la de "hoy no toca nada" y al botón de
  // adelantar, que eran casos particulares de elegir qué y cuánto repasar.
  if (estado === "antes" && resumen) {
    const hoy = resumen.hoy.sinAprender + resumen.hoy.aprendidas;
    const biblioteca = resumen.total.sinAprender + resumen.total.aprendidas;

    if (biblioteca === 0) {
      return (
        <Tarjeta className="flex flex-col gap-4">
          <h1 style={TEXTO_4} className="font-semibold">
            No tienes ninguna palabra todavía
          </h1>
          <p style={TEXTO_2} className="text-texto-suave">
            Añade vocabulario extrayéndolo de un PDF o buscándolo en el diccionario, y
            vuelve a esta pantalla.
          </p>
          <Boton variante="primario" onClick={() => router.push("/extraer")}>
            Extraer de un PDF
          </Boton>
          <Boton variante="secundario" onClick={() => router.push("/diccionario")}>
            Buscar en el diccionario
          </Boton>
        </Tarjeta>
      );
    }

    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          {hoy === 0 ? "Hoy no toca ninguna palabra" : `Hoy tienes ${hoy} palabras`}
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          {hoy === 0
            ? "Estás al día. Si quieres seguir, pon un número y se adelantan las que vengan después."
            : `${resumen.hoy.sinAprender} sin aprender · ${resumen.hoy.aprendidas} aprendidas`}
        </p>

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend style={TEXTO_1} className="text-texto-suave">
            Repasar
          </legend>
          <div className="flex flex-wrap gap-2">
            {MODOS.map((opcion) => (
              <Boton
                key={opcion}
                variante={opcion === modo ? "primario" : "secundario"}
                disabled={!puedeEmpezar(resumen, opcion, cuantas)}
                onClick={() => setModo(opcion)}
              >
                {ETIQUETA_MODO[opcion]} ({disponibles(resumen, opcion, cuantas)})
              </Boton>
            ))}
          </div>
        </fieldset>

        <Campo
          id="tamano-sesion"
          etiqueta="Cuántas"
          claseControl="max-w-40"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAXIMO_TAMANO_SESION}
          value={cuantasBorrador}
          onChange={(evento: React.ChangeEvent<HTMLInputElement>) => {
            setCuantasBorrador(evento.target.value);
            // El aviso se va en cuanto se vuelve a escribir: mientras se teclea
            // el campo pasa por estados a medias (vacío, sobre todo) y señalar
            // cada uno sería regañar por escribir.
            setCuantasError("");
          }}
          onBlur={() =>
            setCuantasError("error" in cuantasValidado ? cuantasValidado.error : "")
          }
          error={cuantasError}
          ayuda={
            cuantasError
              ? undefined
              : "0 = las que toquen hoy. Cualquier otro número es exactamente ese, adelantando las que aún no tocaban."
          }
        />

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={recordar}
            onChange={(evento) => setRecordar(evento.target.checked)}
          />
          <span style={TEXTO_2}>Recordar esta elección</span>
        </label>

        <Boton
          variante="primario"
          // Ya no hay carrera entre el `blur` del campo y este `click`: el
          // número no pasa por el servidor, sale del borrador que se está
          // viendo. Basta con no dejar empezar si ese borrador no vale.
          disabled={!cuantasVale || !puedeEmpezar(resumen, modo, cuantas) || empezando}
          onClick={() => void empezar()}
        >
          {empezando ? "Preparando…" : "Empezar"}
        </Boton>
        <Boton variante="secundario" onClick={() => router.push("/biblioteca")}>
          Volver a la biblioteca
        </Boton>

        {/* El tope diario no es una elección de esta sesión: se guarda al salir
            del campo, como antes, y es el único sitio de la app desde el que se
            puede cambiar. Los contadores de arriba dependen de él, así que se
            vuelven a pedir en cuanto se toca. */}
        <div className="border-t border-borde pt-4">
          <Campo
            id="tope-tarjetas-nuevas"
            etiqueta="Tarjetas nuevas al día"
            claseControl="max-w-40"
            type="number"
            inputMode="numeric"
            min={0}
            max={TOPE_MAXIMO_TARJETAS_NUEVAS}
            value={topeNuevas.borrador}
            disabled={topeNuevas.guardando}
            onChange={(evento: React.ChangeEvent<HTMLInputElement>) =>
              topeNuevas.setBorrador(evento.target.value)
            }
            onBlur={() => void topeNuevas.confirmar().then(refrescarResumen)}
            error={topeNuevas.error}
            ayuda={
              topeNuevas.error
                ? undefined
                : "Cuántas palabras nuevas quieres ver cada día. Se guarda para las próximas sesiones."
            }
          />
        </div>
      </Tarjeta>
    );
  }

  if (estado === "error" || !sesion) {
    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          No se pudo cargar el repaso
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          No hemos podido pedir las tarjetas de hoy. Revisa tu conexión e inténtalo otra vez.
        </p>
        <Boton variante="primario" onClick={() => void recargar()}>
          Reintentar
        </Boton>
      </Tarjeta>
    );
  }

  const { hechas, total } = sesion.progreso();
  const carta = sesion.cartaActual();

  if (!carta) {
    // `conteo`, no `resumen`: ese nombre ya es el de los contadores de la
    // pantalla previa, y aquí se cuentan las respuestas de la sesión.
    const conteo = sesion.resumen();
    const perdidas = sesion.fallidas();
    const terminosPerdidos = perdidas
      .map((termId) => cartas.find((c) => c.termId === termId)?.term ?? `#${termId}`)
      .join(", ");

    return (
      <Tarjeta className="animacion-cierre-sesion flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 style={TEXTO_4} className="font-semibold">
            Repaso terminado
          </h1>
          <p style={TEXTO_2} className="text-texto-suave">
            {conteo.total === 1
              ? "Has repasado 1 tarjeta."
              : `Has repasado ${conteo.total} tarjetas.`}
          </p>
          <p style={TEXTO_2} className="font-medium">
            Buen trabajo, ya has terminado por hoy.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VALORACIONES.map((boton) => (
            <li key={boton.valor} className="flex items-center gap-2">
              <span className={`inline-block size-3 shrink-0 rounded-full ${boton.clase}`} />
              <span style={TEXTO_1}>{boton.etiqueta}</span>
              <span style={TEXTO_1} className="ml-auto font-semibold tabular-nums">
                {conteo[boton.campo]}
              </span>
            </li>
          ))}
        </ul>

        {guardando ? (
          <p style={TEXTO_1} className="text-texto-suave">
            Guardando las últimas respuestas…
          </p>
        ) : null}

        {!guardando && conteo.noGuardadas > 0 ? (
          <p
            role="alert"
            style={TEXTO_2}
            className="rounded-control border border-peligro p-4 text-peligro"
          >
            {conteo.noGuardadas === 1
              ? "1 respuesta no se guardó"
              : `${conteo.noGuardadas} respuestas no se guardaron`}
            , revisa tu conexión: {terminosPerdidos}. Esas tarjetas volverán a aparecer en el
            próximo repaso.
          </p>
        ) : null}

        {/* Puede quedar algo fuera por el número pedido, pero también por el
            modo: "no aprendidas" deja fuera todos los repasos vencidos sin que
            haya ningún límite de por medio. */}
        {repasosFuera > 0 ? (
          <div className="flex flex-col gap-3 border-t border-borde pt-4">
            <p style={TEXTO_2} className="text-texto-suave">
              {repasosFuera === 1
                ? "Queda 1 repaso más para hoy que no entró en esta sesión."
                : `Quedan ${repasosFuera} repasos más para hoy que no entraron en esta sesión.`}
            </p>
            <Boton variante="primario" disabled={empezando} onClick={() => void empezar()}>
              {empezando ? "Preparando…" : "Seguir repasando"}
            </Boton>
          </div>
        ) : null}

        <Boton variante="secundario" disabled={empezando} onClick={() => void recargar()}>
          Volver a elegir
        </Boton>

        <Boton
          variante={repasosFuera > 0 ? "secundario" : "primario"}
          onClick={() => router.push("/biblioteca")}
        >
          Volver a la biblioteca
        </Boton>
      </Tarjeta>
    );
  }

  const porcentaje = Math.round((hechas / total) * 100);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 style={TEXTO_1} className="text-texto-suave">
            {total === 1 ? "Hoy toca 1 tarjeta" : `Hoy tocan ${total} tarjetas`}
          </h1>
          <p style={TEXTO_1} className="text-texto-suave tabular-nums">
            {hechas} / {total}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Progreso de la sesión"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={hechas}
          className="h-1 w-full overflow-hidden rounded-control bg-borde"
        >
          <div className="h-full bg-acento" style={{ width: `${porcentaje}%` }} />
        </div>
      </header>

      <div className="flex flex-1 items-center">
        {revelada ? (
          <Tarjeta className="flex w-full flex-col gap-4">
            <LineaMeta carta={carta} />
            <p style={TEXTO_5} className="font-serif break-words">
              {carta.term}
            </p>
            <p style={TEXTO_4} className="border-t border-borde pt-4 font-semibold">
              {carta.translation}
            </p>
            {carta.example ? (
              <div className="flex flex-col gap-1">
                <p style={TEXTO_1} className="text-texto-suave">
                  Ejemplo
                </p>
                <Frase
                  frase={carta.example}
                  termino={carta.term}
                  style={TEXTO_2}
                  className="leading-relaxed text-texto-suave"
                />
              </div>
            ) : null}
          </Tarjeta>
        ) : (
          <Tarjeta
            role="button"
            tabIndex={0}
            aria-label="Ver la respuesta"
            onClick={revelar}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                revelar();
              }
            }}
            className="flex w-full cursor-pointer flex-col gap-4 text-left"
          >
            <LineaMeta carta={carta} />
            <p style={TEXTO_6} className="font-serif break-words">
              {carta.term}
            </p>
            {carta.senseHint ? (
              <p
                className="line-clamp-1 text-texto-suave"
                style={TEXTO_1}
                title={carta.senseHint}
              >
                {carta.senseHint}
              </p>
            ) : null}
            {mostrarContexto(carta.context, carta.senseHint) ? (
              <Frase
                frase={carta.context}
                termino={carta.term}
                style={TEXTO_3}
                className="leading-relaxed text-texto-suave"
              />
            ) : null}
          </Tarjeta>
        )}
      </div>

      {revelada ? (
        <div className="flex flex-col gap-2">
          {/* Dos columnas en el móvil para que cada botón sea ancho y cómodo a
              una mano; los cuatro en fila en cuanto hay sitio. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VALORACIONES.map((boton) => (
              <button
                key={boton.valor}
                type="button"
                onClick={() => valorar(boton.valor)}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-control px-2 text-texto-sobre-valoracion ${boton.clase}`}
              >
                <span style={TEXTO_2} className="font-medium">
                  {boton.etiqueta}
                </span>
                <span style={TEXTO_1}>{carta.plazos[boton.valor]}</span>
              </button>
            ))}
          </div>
          <p style={TEXTO_1} className="hidden text-center text-texto-suave sm:block">
            Teclas 1 a 4
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Boton variante="primario" className="w-full" onClick={revelar}>
            Ver respuesta
          </Boton>
          <p style={TEXTO_1} className="hidden text-center text-texto-suave sm:block">
            Pulsa la tarjeta o la barra espaciadora
          </p>
        </div>
      )}
    </div>
  );
}
