import type { ButtonHTMLAttributes } from "react";

export type BotonVariante = "primario" | "secundario" | "peligro";

export type BotonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: BotonVariante;
};

// Cada variante lee únicamente los tokens de color definidos en globals.css.
// El texto sobre un fondo de color siempre es blanco, igual que los botones
// de valoración del sistema visual.
const clasesPorVariante: Record<BotonVariante, string> = {
  primario: "border border-transparent bg-acento text-white",
  secundario: "border border-borde bg-transparent text-texto",
  peligro: "border border-transparent bg-valoracion-otra-vez text-white",
};

export function Boton({ variante = "primario", className = "", ...props }: BotonProps) {
  return (
    <button
      {...props}
      style={{ fontSize: "var(--tamano-2)" }}
      className={[
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-6",
        "font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40",
        clasesPorVariante[variante],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
