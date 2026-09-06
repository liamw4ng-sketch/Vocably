"use client";

import { useEffect, useState } from "react";
import type { TermRow } from "@/db/repository/terms";

type Status = "loading" | "loaded" | "error";

export function TermTable() {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cancelled) setStatus("loading");
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : "";
        const response = await fetch(`/api/terms${query}`);
        if (!response.ok) throw new Error(`respuesta ${response.status}`);
        const body = (await response.json()) as { terms: TermRow[] };
        if (!cancelled) {
          setRows(body.terms);
          setStatus("loaded");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [search]);

  async function save(id: number, fields: Partial<TermRow>) {
    await fetch(`/api/terms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function remove(id: number) {
    await fetch(`/api/terms/${id}`, { method: "DELETE" });
    setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar"
        className="rounded border p-3"
      />
      {status === "loading" && <p>Cargando vocabulario…</p>}
      {status === "error" && (
        <p className="text-red-600">
          No se pudo cargar el vocabulario. Inténtalo de nuevo más tarde.
        </p>
      )}
      {status === "loaded" && (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="rounded border p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <strong>{row.term}</strong>
                  <button onClick={() => void remove(row.id)} className="text-sm text-red-600">
                    Borrar
                  </button>
                </div>
                <input
                  defaultValue={row.translation}
                  onBlur={(event) => void save(row.id, { translation: event.target.value })}
                  className="mt-2 w-full rounded border p-2"
                />
                {row.contexts.map((context, index) => (
                  <p key={index} className="mt-2 text-sm italic text-gray-600">
                    {context}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p>Todavía no hay vocabulario guardado.</p>}
        </>
      )}
    </div>
  );
}
