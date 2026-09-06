import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type CampoComun = {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
  className?: string;
};

// Campo de texto o número: usa el atributo nativo `type` ("text", "number",
// "password"…). Campo desplegable: se reconoce por llevar `opciones`.
type CampoEntrada = CampoComun & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

type CampoDesplegable = CampoComun &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> & {
    opciones: { valor: string; etiqueta: string }[];
  };

export type CampoProps = CampoEntrada | CampoDesplegable;

const clasesControl =
  "min-h-12 w-full rounded-control border border-borde bg-superficie px-4 text-texto " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const estiloControl = { fontSize: "var(--tamano-2)" };
const estiloTextoPequeno = { fontSize: "var(--tamano-1)" };

export function Campo(props: CampoProps) {
  const { id, etiqueta, ayuda, error, className = "", ...resto } = props;

  let control: ReactNode;
  if ("opciones" in resto) {
    const { opciones, ...campoProps } = resto;
    control = (
      <select id={id} className={clasesControl} style={estiloControl} {...campoProps}>
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </select>
    );
  } else {
    control = <input id={id} className={clasesControl} style={estiloControl} {...resto} />;
  }

  return (
    <div className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} style={estiloTextoPequeno} className="text-texto-suave">
        {etiqueta}
      </label>
      {control}
      {error ? (
        <p style={estiloTextoPequeno} className="text-valoracion-otra-vez">
          {error}
        </p>
      ) : ayuda ? (
        <p style={estiloTextoPequeno} className="text-texto-suave">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}
