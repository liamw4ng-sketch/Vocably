import Link from "next/link";
import { ExtractForm } from "@/components/ExtractForm";

export default function ExtraerPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 style={{ fontSize: "var(--tamano-4)" }} className="font-semibold text-texto">
          Extraer vocabulario
        </h1>
        <nav className="flex items-baseline gap-4">
          <Link href="/repaso" className="inline-flex min-h-12 items-center underline">
            Repaso
          </Link>
          <Link href="/biblioteca" className="inline-flex min-h-12 items-center underline">
            Biblioteca
          </Link>
        </nav>
      </header>
      <ExtractForm />
    </main>
  );
}
