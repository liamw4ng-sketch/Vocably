import Link from "next/link";
import { TermTable } from "@/components/TermTable";

export default function BibliotecaPage() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
          Biblioteca
        </h1>
        <nav className="flex items-baseline gap-4">
          <Link href="/repaso" className="inline-flex min-h-12 items-center underline">
            Repaso
          </Link>
          <Link href="/extraer" className="inline-flex min-h-12 items-center underline">
            Extraer
          </Link>
          <Link href="/diccionario" className="inline-flex min-h-12 items-center underline">
            Diccionario
          </Link>
        </nav>
      </header>
      <TermTable />
    </main>
  );
}
