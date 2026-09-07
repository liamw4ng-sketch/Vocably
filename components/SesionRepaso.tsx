"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartaCola } from "@/db/repository/review";
import { TOPE_MAXIMO_TARJETAS_NUEVAS } from "@/db/repository/settings";
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
async function pedirCola(adelantar: boolean): Promise<CartaCola[]> {
  const respuesta = await fetch(`/api/repaso/cola${adelantar ? "?adelantar=1" : ""}`);
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { cartas: CartaCola[] };
  return cuerpo.cartas;
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

async function pedirTope(): Promise<number> {
  const respuesta = await fetch("/api/ajustes");
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { newCardsPerDay: number };
  return cuerpo.newCardsPerDay;
}

/** Devuelve el tope guardado, o un mensaje de error en español si el servidor
 * lo rechazó o si la petición ni siquiera pudo hacerse (sin conexión, DNS,
 * servidor caído): en ese caso `fetch` lanza, y sin capturarlo aquí la
 * llamante se quedaría con el `await` colgado para siempre. */
export async function guardarTope(valor: number): Promise<{ tope: number } | { error: string }> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/ajustes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newCardsPerDay: valor }),
    });
  } catch {
    return { error: "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo otra vez." };
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as
    | { newCardsPerDay?: number; error?: string }
    | null;
  if (!respuesta.ok) {
    return { error: cuerpo?.error ?? "No se pudo guardar el cambio." };
  }
  return { tope: cuerpo?.newCardsPerDay ?? valor };
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

  // Control del tope de tarjetas nuevas, mostrado solo en la pantalla de fin
  // de sesión. `tope === null` significa "aún no se ha pedido al servidor,
  // o la petición falló" — cuál de las dos es `topeCargaFallo`, más abajo.
  const [tope, setTope] = useState<number | null>(null);
  const [topeBorrador, setTopeBorrador] = useState("");
  const [topeError, setTopeError] = useState("");
  const [topeGuardando, setTopeGuardando] = useState(false);
  const [topeCargaFallo, setTopeCargaFallo] = useState(false);
  // Si el GET fallara, `tope` seguiría siendo `null` para siempre y nada
  // distinguiría "aún no pedido" de "pedido y fallido" — el efecto de abajo
  // volvería a intentarlo en cada render. Este ref es la señal real de
  // "ya lo hemos intentado", independiente del resultado.
  const topeSolicitadoRef = useRef(false);

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

  // Carga inicial: función async dentro del efecto con su guard, igual que en
  // TermTable, para no encadenar renders desde el cuerpo del efecto.
  useEffect(() => {
    let cancelado = false;

    async function cargarInicial() {
      try {
        const cola = await pedirCola(false);
        if (!cancelado) {
          setCartas(cola);
          setSesion(crearSesion(cola, { enviar: enviarRespuesta }));
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
  useEffect(() => {
    if (!sesion || topeSolicitadoRef.current) return;
    if (sesion.progreso().total === 0 || sesion.cartaActual()) return;

    topeSolicitadoRef.current = true;
    let cancelado = false;
    pedirTope()
      .then((valor) => {
        if (!cancelado) {
          setTope(valor);
          setTopeBorrador(String(valor));
        }
      })
      .catch(() => {
        // No bloqueamos el cierre de la sesión, pero sí lo decimos: sin esto
        // el control simplemente no aparecía y nada explicaba por qué.
        if (!cancelado) setTopeCargaFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [sesion, version]);

  /** Reintentar tras un error, o adelantar palabras nuevas: siempre desde un evento. */
  const recargar = useCallback(async (adelantar: boolean) => {
    setEstado("cargando");
    try {
      const cola = await pedirCola(adelantar);
      setCartas(cola);
      setSesion(crearSesion(cola, { enviar: enviarRespuesta }));
      setRevelada(false);
      setGuardando(false);
      setAdelantado(adelantar);
      setEstado("lista");
    } catch {
      setEstado("error");
    }
  }, []);

  const revelar = useCallback(() => setRevelada(true), []);

  /** Se llama al salir del campo del tope. Valida en el cliente para no
   * esperar a la red con un valor obviamente malo, pero el servidor sigue
   * siendo quien decide: si lo rechaza, el campo vuelve al último valor
   * guardado y enseña el motivo. */
  async function confirmarTope() {
    const texto = topeBorrador.trim();
    const valor = Number(texto);
    if (
      texto === "" ||
      !Number.isInteger(valor) ||
      valor < 0 ||
      valor > TOPE_MAXIMO_TARJETAS_NUEVAS
    ) {
      setTopeError(`Debe ser un número entero entre 0 y ${TOPE_MAXIMO_TARJETAS_NUEVAS}.`);
      return;
    }
    if (valor === tope) {
      setTopeError("");
      return;
    }

    setTopeGuardando(true);
    setTopeError("");
    try {
      const resultado = await guardarTope(valor);
      if (!montadoRef.current) return;
      if ("error" in resultado) {
        setTopeError(resultado.error);
        setTopeBorrador(String(tope ?? valor));
        return;
      }
      setTope(resultado.tope);
      setTopeBorrador(String(resultado.tope));
    } finally {
      // `finally` en vez de un `setTopeGuardando(false)` tras el `await`:
      // así el campo se reactiva pase lo que pase, incluso si `guardarTope`
      // (u otra cosa inesperada) llegara a lanzar. Ver hallazgo 1 del
      // informe: antes, un `fetch` que lanzaba dejaba el campo deshabilitado
      // para siempre.
      if (montadoRef.current) setTopeGuardando(false);
    }
  }

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

  if (total === 0) {
    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          Hoy no toca ninguna tarjeta
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          {adelantado
            ? "Tampoco quedan palabras nuevas en la biblioteca. Añade más desde la pantalla de extraer."
            : "Estás al día. Si quieres seguir, puedes adelantar palabras nuevas de la biblioteca."}
        </p>
        {adelantado ? null : (
          <Boton variante="primario" onClick={() => void recargar(true)}>
            Adelantar palabras nuevas
          </Boton>
        )}
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

        {tope === null && topeCargaFallo ? (
          <p style={TEXTO_1} className="border-t border-borde pt-4 text-texto-suave">
            No se ha podido cargar el tope de tarjetas nuevas. Actualiza la página para
            intentarlo de nuevo.
          </p>
        ) : null}

        {tope !== null ? (
          <div className="flex flex-col gap-2 border-t border-borde pt-4">
            <Campo
              id="tope-tarjetas-nuevas"
              etiqueta="Tarjetas nuevas al día"
              className="max-w-40"
              type="number"
              inputMode="numeric"
              min={0}
              max={TOPE_MAXIMO_TARJETAS_NUEVAS}
              value={topeBorrador}
              disabled={topeGuardando}
              onChange={(evento: React.ChangeEvent<HTMLInputElement>) =>
                setTopeBorrador(evento.target.value)
              }
              onBlur={() => void confirmarTope()}
              error={topeError}
              ayuda={
                topeError
                  ? undefined
                  : "Cuántas palabras nuevas quieres ver cada día. Se guarda para las próximas sesiones."
              }
            />
          </div>
        ) : null}

        <Boton variante="primario" onClick={() => router.push("/biblioteca")}>
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
