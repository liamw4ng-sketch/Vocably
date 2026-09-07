"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartaCola, Cola } from "@/db/repository/review";
import { TOPE_MAXIMO_TARJETAS_NUEVAS, MAXIMO_REPASOS_POR_SESION } from "@/lib/ajustes";
import { crearSesion, type EnvioRespuesta, type Sesion, type Valoracion } from "@/lib/review-session";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

type Estado = "cargando" | "error" | "lista";

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

/** Pide la cola del día. Sin estado de React dentro: solo red. */
async function pedirCola(adelantar: boolean): Promise<Cola> {
  const respuesta = await fetch(`/api/repaso/cola${adelantar ? "?adelantar=1" : ""}`);
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

/** Los dos ajustes editables desde esta pantalla. */
export type CampoAjuste = "newCardsPerDay" | "reviewsPerSession";
type Ajustes = Record<CampoAjuste, number>;

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
 * Un ajuste numérico editable: borrador, validación en el cliente, guardado y
 * vuelta al último valor bueno si el servidor lo rechaza. Los dos ajustes se
 * comportan igual, y una segunda copia de estas líneas acabaría divergiendo
 * justo donde más duele: en la validación o en el manejo del error.
 *
 * No pide su propio valor al servidor: los dos llegan en la misma respuesta y
 * quien monta la pantalla los reparte con `fijar`.
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
  const [adelantado, setAdelantado] = useState(false);
  // `Sesion` es un objeto mutable sin React dentro: hay que pedir el redibujo.
  // `version` se expone (antes se descartaba) para poder usarlo como
  // dependencia del efecto de carga del tope, más abajo: es la señal de "algo
  // relevante ha cambiado" que ese efecto necesita para volver a comprobar si
  // la sesión ya terminó.
  const [version, redibujar] = useReducer((n: number) => n + 1, 0);

  // Repasos que el límite por sesión dejó fuera. Se lee al pedir la cola y se
  // enseña al terminar: sin esto, un límite por debajo del ritmo diario
  // acumula atrasos sin que nada lo diga.
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

  // Los dos ajustes, mostrados en las pantallas en las que no hay una sesión
  // en marcha: la de fin de sesión y la de "hoy no toca nada". `valor === null`
  // significa "aún no se ha pedido al servidor, o la petición falló" — cuál de
  // las dos es `ajustesCargaFallo`, más abajo.
  const topeNuevas = useAjusteNumerico("newCardsPerDay", TOPE_MAXIMO_TARJETAS_NUEVAS, montadoRef);
  const repasosSesion = useAjusteNumerico("reviewsPerSession", MAXIMO_REPASOS_POR_SESION, montadoRef);
  const [ajustesCargaFallo, setAjustesCargaFallo] = useState(false);
  // Si el GET fallara, los valores seguirían siendo `null` para siempre y nada
  // distinguiría "aún no pedido" de "pedido y fallido" — el efecto de abajo
  // volvería a intentarlo en cada render. Este ref es la señal real de
  // "ya lo hemos intentado", independiente del resultado.
  const ajustesSolicitadosRef = useRef(false);

  // Carga inicial: función async dentro del efecto con su guard, igual que en
  // TermTable, para no encadenar renders desde el cuerpo del efecto.
  useEffect(() => {
    let cancelado = false;

    async function cargarInicial() {
      try {
        const cola = await pedirCola(false);
        if (!cancelado) {
          setCartas(cola.cartas);
          setRepasosFuera(cola.repasosFuera);
          setSesion(crearSesion(cola.cartas, { enviar: enviarRespuesta }));
          setEstado("lista");
        }
      } catch {
        if (!cancelado) setEstado("error");
      }
    }

    void cargarInicial();
    return () => {
      cancelado = true;
    };
  }, []);

  // `sesion` no cambia de referencia durante toda la sesión (es un objeto
  // mutable), así que la única señal de "puede que la sesión acabe de
  // terminar" es `version`: se incrementa en cada `redibujar()`, que
  // `valorar` llama después de responder cada tarjeta, incluida la última.
  // El guard real de "no lo pidas dos veces" es `topeSolicitadoRef`, no el
  // resultado de la petición: así, si el GET falla, no se reintenta en cada
  // render (incluidos los que no tienen nada que ver, como el de la barra
  // espaciadora) — se intenta una vez y, si falla, se informa con
  // `topeCargaFallo` en vez de martillear el servidor.
  //
  // La condición es "no hay tarjeta en curso", que cubre los dos finales: la
  // sesión terminada y la cola que llegó vacía. Antes se descartaba
  // explícitamente `total === 0`, y con el tope a 0 eso encerraba al usuario:
  // la cola se vaciaba, la única pantalla con el control era la de fin de
  // sesión —a la que ya no se podía llegar— y no hay pantalla de ajustes.
  useEffect(() => {
    if (!sesion || ajustesSolicitadosRef.current) return;
    if (sesion.cartaActual()) return;

    ajustesSolicitadosRef.current = true;
    let cancelado = false;
    pedirAjustes()
      .then((ajustes) => {
        if (!cancelado) {
          topeNuevas.fijar(ajustes.newCardsPerDay);
          repasosSesion.fijar(ajustes.reviewsPerSession);
        }
      })
      .catch(() => {
        // No bloqueamos el cierre de la sesión, pero sí lo decimos: sin esto
        // el control simplemente no aparecía y nada explicaba por qué.
        if (!cancelado) setAjustesCargaFallo(true);
      });
    return () => {
      cancelado = true;
    };
    // `fijar` es estable (useCallback sin dependencias); lo que dispara este
    // efecto es que la sesión llegue a su final, que es lo que señala `version`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion, version]);

  /** Reintentar tras un error, o adelantar palabras nuevas: siempre desde un evento. */
  const recargar = useCallback(async (adelantar: boolean) => {
    setEstado("cargando");
    try {
      const cola = await pedirCola(adelantar);
      setCartas(cola.cartas);
      setRepasosFuera(cola.repasosFuera);
      setSesion(crearSesion(cola.cartas, { enviar: enviarRespuesta }));
      setRevelada(false);
      setGuardando(false);
      setAdelantado(adelantar);
      setEstado("lista");
    } catch {
      setEstado("error");
    }
  }, []);

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

  if (estado === "error" || !sesion) {
    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          No se pudo cargar el repaso
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          No hemos podido pedir las tarjetas de hoy. Revisa tu conexión e inténtalo otra vez.
        </p>
        <Boton variante="primario" onClick={() => void recargar(false)}>
          Reintentar
        </Boton>
      </Tarjeta>
    );
  }

  const { hechas, total } = sesion.progreso();
  const carta = sesion.cartaActual();

  // Un solo control para las dos pantallas de final (sesión terminada y cola
  // vacía): misma validación, mismo aviso de guardado, misma recuperación si
  // el servidor rechaza el valor. Dos copias del control acabarían divergiendo.
  const controlAjustes =
    topeNuevas.valor !== null ? (
      <div className="flex flex-col gap-4 border-t border-borde pt-4">
        <Campo
          id="tope-tarjetas-nuevas"
          etiqueta="Tarjetas nuevas al día"
          className="max-w-40"
          type="number"
          inputMode="numeric"
          min={0}
          max={TOPE_MAXIMO_TARJETAS_NUEVAS}
          value={topeNuevas.borrador}
          disabled={topeNuevas.guardando}
          onChange={(evento: React.ChangeEvent<HTMLInputElement>) =>
            topeNuevas.setBorrador(evento.target.value)
          }
          onBlur={() => void topeNuevas.confirmar()}
          error={topeNuevas.error}
          ayuda={
            topeNuevas.error
              ? undefined
              : "Cuántas palabras nuevas quieres ver cada día. Se guarda para las próximas sesiones."
          }
        />
        <Campo
          id="repasos-por-sesion"
          etiqueta="Repasos por sesión"
          className="max-w-40"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAXIMO_REPASOS_POR_SESION}
          value={repasosSesion.borrador}
          disabled={repasosSesion.guardando}
          onChange={(evento: React.ChangeEvent<HTMLInputElement>) =>
            repasosSesion.setBorrador(evento.target.value)
          }
          onBlur={() => void repasosSesion.confirmar()}
          error={repasosSesion.error}
          ayuda={
            repasosSesion.error
              ? undefined
              : "Cuántas palabras ya aprendidas entran en cada sesión, elegidas al azar entre las que toquen. 0 = todas."
          }
        />
      </div>
    ) : ajustesCargaFallo ? (
      <p style={TEXTO_1} className="border-t border-borde pt-4 text-texto-suave">
        No se han podido cargar los ajustes del repaso. Actualiza la página para intentarlo
        de nuevo.
      </p>
    ) : null;

  if (total === 0) {
    // Con el tope a 0 no entra ninguna palabra nueva, así que adelantar
    // tampoco daría ninguna: en vez de ofrecer un botón que no puede hacer
    // nada, se dice por qué y se deja el control del tope justo debajo.
    const topeEnCero = topeNuevas.valor === 0;
    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          Hoy no toca ninguna tarjeta
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          {topeEnCero
            ? "Tienes el tope de tarjetas nuevas en 0, así que hoy no entra ninguna palabra nueva. Súbelo aquí abajo cuando quieras volver a aprender vocabulario nuevo."
            : adelantado
              ? "Tampoco quedan palabras nuevas en la biblioteca. Añade más desde la pantalla de extraer."
              : "Estás al día. Si quieres seguir, puedes adelantar palabras nuevas de la biblioteca."}
        </p>
        {adelantado || topeEnCero ? null : (
          <Boton variante="primario" onClick={() => void recargar(true)}>
            Adelantar palabras nuevas
          </Boton>
        )}
        {controlAjustes}
        <Boton variante="secundario" onClick={() => router.push("/biblioteca")}>
          Volver a la biblioteca
        </Boton>
      </Tarjeta>
    );
  }

  if (!carta) {
    const resumen = sesion.resumen();
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
            {resumen.total === 1
              ? "Has repasado 1 tarjeta."
              : `Has repasado ${resumen.total} tarjetas.`}
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
                {resumen[boton.campo]}
              </span>
            </li>
          ))}
        </ul>

        {guardando ? (
          <p style={TEXTO_1} className="text-texto-suave">
            Guardando las últimas respuestas…
          </p>
        ) : null}

        {!guardando && resumen.noGuardadas > 0 ? (
          <p
            role="alert"
            style={TEXTO_2}
            className="rounded-control border border-peligro p-4 text-peligro"
          >
            {resumen.noGuardadas === 1
              ? "1 respuesta no se guardó"
              : `${resumen.noGuardadas} respuestas no se guardaron`}
            , revisa tu conexión: {terminosPerdidos}. Esas tarjetas volverán a aparecer en el
            próximo repaso.
          </p>
        ) : null}

        {repasosFuera > 0 ? (
          <div className="flex flex-col gap-3 border-t border-borde pt-4">
            <p style={TEXTO_2} className="text-texto-suave">
              {repasosFuera === 1
                ? "Queda 1 repaso más para hoy, fuera del límite de esta sesión."
                : `Quedan ${repasosFuera} repasos más para hoy, fuera del límite de esta sesión.`}
            </p>
            <Boton variante="primario" onClick={() => void recargar(false)}>
              Seguir repasando
            </Boton>
          </div>
        ) : null}

        {controlAjustes}

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
            {carta.context ? (
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
