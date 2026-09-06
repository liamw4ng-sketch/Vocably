import Link from "next/link";
import { SesionRepaso } from "@/components/SesionRepaso";

export default function RepasoPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
      <nav className="flex items-center justify-end">
        <Link href="/biblioteca" className="inline-flex min-h-12 items-center underline">
          Biblioteca
        </Link>
      </nav>
      <SesionRepaso />
    </main>
  );
}
