import type { HTMLAttributes } from "react";

export type TarjetaProps = HTMLAttributes<HTMLDivElement>;

export function Tarjeta({ className = "", ...props }: TarjetaProps) {
  return (
    <div
      {...props}
      className={["rounded-tarjeta border border-borde bg-superficie p-6", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
