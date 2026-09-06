"use client";

import { useCallback, useEffect, useState } from "react";
import type { TermRow } from "@/db/repository/terms";
import { CEFR_LEVELS } from "@/lib/extraction-schema";

type Status = "loading" | "loaded" | "error";

/** Los campos que se pueden corregir a mano, tal y como los acepta el PATCH. */
type EditableField = "term" | "translation" | "type" | "level";

const TYPE_LABELS: Record<string, string> = {
  word: "palabra",
  phrasal_verb: "verbo frasal",
  expression: "expresión",
};

const TERM_TYPES = ["word", "phrasal_verb", "expression"] as const;

type Filters = { search: string; source: string; level: string; type: string };

const NO_FILTERS: Filters = { search: "", source: "", level: "", type: "" };

async function fetchTerms(filters: Partial<Filters>): Promise<TermRow[]> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) query.set(name, value);
  }
  const suffix = query.toString() ? `?${query}` : "";
  const response = await fetch(`/api/terms${suffix}`);
  if (!response.ok) throw new Error(`respuesta ${response.status}`);
  const body = (await response.json()) as { terms: TermRow[] };
  return body.terms;
}

/** El mensaje que da el servidor, o uno genérico si la respuesta no trae JSON. */
async function errorMessage(response: Response): Promise<string> {
  const fallback = `El servidor respondió ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "es"));
}

export function TermTable() {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Instantánea sin filtros: es lo que puebla los desplegables, para que sigan
  // ofreciendo todas las fuentes aunque el filtro actual deje la lista vacía.
  const [everything, setEverything] = useState<TermRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const { search, source, level, type } = filters;

  const loadOptions = useCallback(async () => {
    try {
      setEverything(await fetchTerms({}));
    } catch {
      // Si esto falla, la carga principal ya avisa del error; los desplegables
      // se quedan con lo último que se supo.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cancelled) setStatus("loading");
      try {
        const terms = await fetchTerms({ search, source, level, type });
        if (!cancelled) {
          setRows(terms);
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
  }, [search, source, level, type]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  /** Vuelve a leer del servidor sin pasar por "Cargando", para no tapar el error. */
  const refresh = useCallback(async () => {
    try {
      setRows(await fetchTerms({ search, source, level, type }));
    } catch {
      setStatus("error");
    }
    await loadOptions();
  }, [search, source, level, type, loadOptions]);

  function draftKey(id: number, field: EditableField) {
    return `${id}:${field}`;
  }

  function valueOf(row: TermRow, field: EditableField) {
    return drafts[draftKey(row.id, field)] ?? row[field];
  }

  function setDraft(id: number, field: EditableField, value: string) {
    setDrafts((current) => ({ ...current, [draftKey(id, field)]: value }));
  }

  function clearDraft(id: number, field: EditableField) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[draftKey(id, field)];
      return next;
    });
  }

  function setRowError(id: number, message: string) {
    setRowErrors((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /**
   * Guarda un campo y vuelve a leer la fila del servidor. Si el servidor lo
   * rechaza (por ejemplo, un 409 al renombrar un término sobre otro que ya
   * existe), se enseña el motivo y la pantalla recupera el valor guardado en
   * vez de quedarse enseñando algo que no llegó a guardarse.
   */
  async function save(row: TermRow, field: EditableField, value: string) {
    if (value === row[field]) {
      clearDraft(row.id, field);
      return;
    }
    setRowError(row.id, "");

    try {
      const response = await fetch(`/api/terms/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) setRowError(row.id, await errorMessage(response));
    } catch {
      setRowError(row.id, "No se pudo guardar el cambio: no hay conexión con el servidor.");
    }

    clearDraft(row.id, field);
    await refresh();
  }

  async function remove(id: number) {
    setRowError(id, "");
    try {
      const response = await fetch(`/api/terms/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setRowError(id, await errorMessage(response));
        return;
      }
    } catch {
      setRowError(id, "No se pudo borrar el término: no hay conexión con el servidor.");
      return;
    }
    await refresh();
  }

  const sourceOptions = unique(everything.flatMap((row) => row.sources));
  const levelOptions = unique(everything.map((row) => row.level));
  const typeOptions = unique(everything.map((row) => row.type));

  return (
    <div className="flex flex-col gap-4">
      <input
        value={search}
        onChange={(event) => setFilters({ ...filters, search: event.target.value })}
        placeholder="Buscar"
        className="rounded border p-3"
      />

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Fuente
          <select
            value={source}
            onChange={(event) => setFilters({ ...filters, source: event.target.value })}
            className="rounded border p-2"
          >
            <option value="">Todas</option>
            {sourceOptions.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Nivel
          <select
            value={level}
            onChange={(event) => setFilters({ ...filters, level: event.target.value })}
            className="rounded border p-2"
          >
            <option value="">Todos</option>
            {levelOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Tipo
          <select
            value={type}
            onChange={(event) => setFilters({ ...filters, type: event.target.value })}
            className="rounded border p-2"
          >
            <option value="">Todos</option>
            {typeOptions.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
      </div>

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
                  <input
                    value={valueOf(row, "term")}
                    onChange={(event) => setDraft(row.id, "term", event.target.value)}
                    onBlur={(event) => void save(row, "term", event.target.value)}
                    aria-label="Término"
                    className="flex-1 rounded border p-2 font-semibold"
                  />
                  <button onClick={() => void remove(row.id)} className="text-sm text-red-600">
                    Borrar
                  </button>
                </div>

                <input
                  value={valueOf(row, "translation")}
                  onChange={(event) => setDraft(row.id, "translation", event.target.value)}
                  onBlur={(event) => void save(row, "translation", event.target.value)}
                  aria-label="Traducción"
                  className="mt-2 w-full rounded border p-2"
                />

                <div className="mt-2 flex gap-3">
                  <select
                    value={row.type}
                    onChange={(event) => void save(row, "type", event.target.value)}
                    aria-label="Tipo"
                    className="flex-1 rounded border p-2 text-sm"
                  >
                    {TERM_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {TYPE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.level}
                    onChange={(event) => void save(row, "level", event.target.value)}
                    aria-label="Nivel"
                    className="flex-1 rounded border p-2 text-sm"
                  >
                    {CEFR_LEVELS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>

                {rowErrors[row.id] && (
                  <p className="mt-2 text-sm text-red-600">{rowErrors[row.id]}</p>
                )}

                {row.sources.length > 0 && (
                  <p className="mt-2 text-sm text-gray-600">De: {row.sources.join(", ")}</p>
                )}

                {row.contexts.map((context, index) => (
                  <p key={index} className="mt-2 text-sm italic text-gray-600">
                    {context}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {rows.length === 0 &&
            (search || source || level || type ? (
              <p>Ningún término coincide con estos filtros.</p>
            ) : (
              <p>Todavía no hay vocabulario guardado.</p>
            ))}
        </>
      )}
    </div>
  );
}
