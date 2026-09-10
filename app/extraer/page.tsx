import { ExtractForm } from "@/components/ExtractForm";
import { ExtraerSinIA } from "@/components/ExtraerSinIA";

const TEXTO_1 = { fontSize: "var(--tamano-1)" };

export default function ExtraerPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-10 p-6">
      <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
        Extraer
      </h1>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 style={{ fontSize: "var(--tamano-3)" }} className="font-semibold text-texto">
            Con IA
          </h2>
          <p style={TEXTO_1} className="text-texto-suave">
            Claude lee el PDF y elige el vocabulario por ti. Tiene un coste en dólares por cada
            extracción.
          </p>
        </div>
        <ExtractForm />
      </section>

      <hr className="border-borde" />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 style={{ fontSize: "var(--tamano-3)" }} className="font-semibold text-texto">
            Sin IA
          </h2>
          <p style={TEXTO_1} className="text-texto-suave">
            El diccionario del proyecto elige las candidatas y filtra por nivel. Es gratis: no
            llama a Claude ni a ningún servicio de pago.
          </p>
        </div>
        <ExtraerSinIA />
      </section>
    </main>
  );
}
