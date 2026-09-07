"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        router.push("/extraer");
      } else {
        setError("Contraseña incorrecta.");
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <Tarjeta className="flex w-full max-w-sm flex-col gap-6">
        <h1 style={{ fontSize: "var(--tamano-5)" }} className="font-semibold text-texto">
          Vocably
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Campo
            id="password"
            etiqueta="Contraseña"
            type="password"
            value={password}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            autoFocus
            error={error || undefined}
          />
          <Boton type="submit" variante="primario" disabled={enviando}>
            {enviando ? "Entrando…" : "Entrar"}
          </Boton>
        </form>
      </Tarjeta>
    </main>
  );
}
