import Link from "next/link";
import { TermTable } from "@/components/TermTable";

export default function BibliotecaPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca</h1>
        <Link href="/extraer" className="underline">
          Extraer
        </Link>
      </header>
      <TermTable />
    </main>
  );
}
