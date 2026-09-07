"use client";

import { useState } from "react";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { planBatches } from "@/lib/pdf-slice";
import { runExtraction, type RunSummary, type PostBatchBody } from "@/lib/run-extraction";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

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

const TEXTO_1 = { fontSize: "var(--tamano-1)" };
const TEXTO_2 = { fontSize: "var(--tamano-2)" };
const TEXTO_3 = { fontSize: "var(--tamano-3)" };

export function ExtractForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(1);
  const [level, setLevel] = useState<string>("B2");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState("");
  const [arrastrando, setArrastrando] = useState(false);

  // Solo para mostrar el rango de páginas del lote en curso: se calcula con
  // la misma función pura que usa runExtraction internamente, con los mismos
  // argumentos. No participa en la extracción real ni cambia su resultado.
  const [lotes, setLotes] = useState<Array<{ pageStart: number; pageEnd: number }>>([]);

  const running = progress !== null && summary === null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setError("");
    setSummary(null);
    setProgress({ done: 0, total: 0 });

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setLotes(planBatches(pageStart, pageEnd));
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

  function onDropArchivo(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setArrastrando(false);
    const soltado = event.dataTransfer.files?.[0];
    if (soltado) setFile(soltado);
  }

  const loteEnCurso =
    progress && progress.done < lotes.length ? lotes[progress.done] : null;
  const porcentaje =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 style={TEXTO_1} className="font-medium text-texto-suave">
          1. El PDF
        </h2>
        <label
          htmlFor="pdf-archivo"
          onDragOver={(event) => {
            event.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={onDropArchivo}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border border-dashed p-8 text-center",
            arrastrando ? "border-acento bg-fondo" : "border-borde bg-superficie",
          ].join(" ")}
        >
          <span style={TEXTO_2} className="font-medium text-texto">
            {file ? file.name : "Arrastra tu PDF aquí"}
          </span>
          <span style={TEXTO_1} className="text-texto-suave">
            {file ? "Haz clic para elegir otro archivo" : "o haz clic para elegirlo"}
          </span>
          <input
            id="pdf-archivo"
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>
        <Campo
          id="titulo-libro"
          etiqueta="Título del libro (opcional)"
          value={title}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4">
        <h2 style={TEXTO_1} className="font-medium text-texto-suave">
          2. Rango y nivel
        </h2>
        <div className="flex gap-3">
          <Campo
            id="pagina-inicio"
            etiqueta="Desde la página"
            className="flex-1"
            type="number"
            inputMode="numeric"
            min={1}
            value={pageStart}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setPageStart(Number(event.target.value))
            }
          />
          <Campo
            id="pagina-fin"
            etiqueta="Hasta la página"
            className="flex-1"
            type="number"
            inputMode="numeric"
            min={1}
            value={pageEnd}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setPageEnd(Number(event.target.value))
            }
          />
        </div>
        <Campo
          id="nivel"
          etiqueta="Nivel"
          value={level}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setLevel(event.target.value)}
          opciones={CEFR_LEVELS.map((value) => ({ valor: value, etiqueta: value }))}
        />
      </div>

      <Boton type="submit" variante="primario" disabled={!file || running} className="w-full">
        {running ? "Extrayendo…" : "Extraer vocabulario"}
      </Boton>

      {progress && progress.total > 0 && (
        <div className="flex flex-col gap-2">
          <p style={TEXTO_1} className="text-texto-suave">
            Lote {progress.done} de {progress.total}
            {loteEnCurso ? ` · páginas ${loteEnCurso.pageStart}-${loteEnCurso.pageEnd}` : ""}
          </p>
          <div
            role="progressbar"
            aria-label="Progreso de la extracción"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            className="h-1 w-full overflow-hidden rounded-control bg-borde"
          >
            <div className="h-full bg-acento" style={{ width: `${porcentaje}%` }} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={TEXTO_2} className="rounded-control border border-peligro p-4 text-peligro">
          {error}
        </p>
      )}

      {summary && (
        <Tarjeta className="flex flex-col gap-4">
          <h2 style={TEXTO_3} className="font-semibold">
            Extracción completada
          </h2>
          <div className="flex flex-col gap-1">
            <p style={TEXTO_2}>
              {summary.created} términos nuevos, {summary.merged} ya los tenías.
            </p>
            <p style={TEXTO_1} className="text-texto-suave">
              Coste de esta extracción: {summary.costUsd.toFixed(3)} $
            </p>
          </div>

          {summary.failed.length > 0 && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-control border border-peligro p-4 text-peligro"
            >
              <p style={TEXTO_2} className="font-medium">
                Fallaron estos lotes. Vuelve a lanzar solo ese rango:
              </p>
              <ul className="flex flex-col gap-1">
                {summary.failed.map((failure) => (
                  <li key={`${failure.pageStart}-${failure.pageEnd}`} style={TEXTO_1}>
                    <strong>
                      Páginas {failure.pageStart}-{failure.pageEnd}:
                    </strong>{" "}
                    {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Tarjeta>
      )}
    </form>
  );
}
