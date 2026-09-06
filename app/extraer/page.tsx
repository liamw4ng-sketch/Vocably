import Link from "next/link";
import { ExtractForm } from "@/components/ExtractForm";

export default function ExtraerPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Extraer vocabulario</h1>
        <Link href="/biblioteca" className="underline">
          Biblioteca
        </Link>
      </header>
      <ExtractForm />
    </main>
  );
}
