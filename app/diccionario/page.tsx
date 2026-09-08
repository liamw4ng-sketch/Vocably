import { BuscadorDiccionario } from "@/components/BuscadorDiccionario";

export default function DiccionarioPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
        Diccionario
      </h1>
      <BuscadorDiccionario />
    </main>
  );
}
