import { TermTable } from "@/components/TermTable";

export default function BibliotecaPage() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-6 p-6">
      <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
        Biblioteca
      </h1>
      <TermTable />
    </main>
  );
}
