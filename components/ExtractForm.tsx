"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { runExtraction, type RunSummary, type PostBatchBody } from "@/lib/run-extraction";

async function postBatch(body: PostBatchBody) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({ error: "error desconocido" }));
    throw new Error(error);
  }
  return response.json();
}

export function ExtractForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(1);
  const [level, setLevel] = useState<string>("B2");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState("");

  const running = progress !== null && summary === null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setError("");
    setSummary(null);
    setProgress({ done: 0, total: 0 });

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runExtraction(
        { bytes, title: title || file.name, pageStart, pageEnd, level },
        { post: postBatch, onProgress: setProgress },
      );
      setSummary(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo procesar el PDF.");
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        type="file"
        accept="application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="rounded border p-3"
      />
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Título del libro (opcional)"
        className="rounded border p-3"
      />
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Desde la página
          <input
            type="number"
            min={1}
            value={pageStart}
            onChange={(event) => setPageStart(Number(event.target.value))}
            className="rounded border p-3"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Hasta la página
          <input
            type="number"
            min={1}
            value={pageEnd}
            onChange={(event) => setPageEnd(Number(event.target.value))}
            className="rounded border p-3"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Nivel
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value)}
          className="rounded border p-3"
        >
          {CEFR_LEVELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={!file || running}
        className="rounded bg-black p-3 text-white disabled:opacity-40"
      >
        {running ? "Extrayendo…" : "Extraer vocabulario"}
      </button>

      {progress && progress.total > 0 && (
        <p>
          Lote {progress.done} de {progress.total}
        </p>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {summary && (
        <div className="rounded border p-4">
          <p>
            {summary.created} términos nuevos, {summary.merged} ya los tenías.
          </p>
          <p className="text-sm text-gray-600">
            Coste de esta extracción: {summary.costUsd.toFixed(3)} $
          </p>
          {summary.failed.length > 0 && (
            <p className="mt-2 text-red-600">
              Fallaron las páginas{" "}
              {summary.failed.map((f) => `${f.pageStart}-${f.pageEnd}`).join(", ")}. Vuelve a
              lanzar solo ese rango.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
