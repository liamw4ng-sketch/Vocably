import type { ButtonHTMLAttributes } from "react";

export type BotonVariante = "primario" | "secundario" | "peligro";

export type BotonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: BotonVariante;
};

// Cada variante lee únicamente los tokens de color definidos en globals.css.
// Los pares fondo/texto ya están calibrados en globals.css para cumplir el
// mínimo de contraste 4.5:1 (acento-solido/peligro no son --acento ni los
// colores de valoración: son superficies de relleno propias).
const clasesPorVariante: Record<BotonVariante, string> = {
  primario: "border border-transparent bg-acento-solido text-texto-sobre-acento",
  secundario: "border border-borde bg-transparent text-texto",
  peligro: "border border-transparent bg-peligro text-texto-sobre-peligro",
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
