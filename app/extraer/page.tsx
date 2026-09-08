import { ExtractForm } from "@/components/ExtractForm";

export default function ExtraerPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
        Extraer
      </h1>
      <ExtractForm />
    </main>
  );
}
