"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DESTINOS, esRutaActiva, muestraBarra } from "@/lib/navegacion";

/**
 * La navegación de la aplicación, fija abajo y al alcance del pulgar.
 *
 * Antes cada pantalla llevaba su propia lista de enlaces a las demás, y eso ya
 * se había torcido: `/repaso` enlazaba a dos de las otras tres y se dejaba
 * `/extraer`. Con una sola barra en el layout eso no puede volver a pasar.
 */
export function BarraNavegacion() {
  const camino = usePathname() ?? "";
  if (!muestraBarra(camino)) return null;

  return (
    <>
      {/* La barra es fija, así que no ocupa sitio en el flujo: sin este hueco
          taparía el principio de cada pantalla. */}
      <div
        aria-hidden
        className="h-16 shrink-0"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      />
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 top-0 z-10 border-b border-borde bg-superficie"
        // Arriba y no abajo: en un iPhone la franja de abajo es del gesto de
        // inicio del sistema, y una barra ahí se pelea con él por los mismos
        // píxeles por mucho margen de seguridad que se le ponga.
        // `safe-area-inset-top` deja sitio a la isla dinámica y a la hora.
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <ul className="mx-auto flex w-full max-w-xl">
          {DESTINOS.map((destino) => {
            const activo = esRutaActiva(camino, destino.href);
            return (
              <li key={destino.href} className="flex-1">
                <Link
                  href={destino.href}
                  aria-current={activo ? "page" : undefined}
                  style={{ fontSize: "var(--tamano-1)" }}
                  className={[
                    // `min-h-12` mantiene el objetivo táctil de 48px que usan
                    // los botones del resto de la aplicación.
                    "flex min-h-12 flex-col items-center justify-center gap-1 px-1 text-center",
                    // La marca de la pantalla activa no es solo el color: lleva
                    // además la línea de arriba, el peso de la letra y
                    // `aria-current`, para que se distinga sin depender de
                    // distinguir colores.
                    activo ? "font-semibold text-acento" : "text-texto-suave",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={[
                      "h-0.5 w-6 rounded-full",
                      activo ? "bg-acento" : "bg-transparent",
                    ].join(" ")}
                  />
                  {destino.etiqueta}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
