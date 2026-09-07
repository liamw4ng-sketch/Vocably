"use client";

import { useCallback, useEffect, useState } from "react";
import type { TermRow } from "@/db/repository/terms";
import { CEFR_LEVELS } from "@/lib/extraction-schema";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

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

const TEXTO_1 = { fontSize: "var(--tamano-1)" };
const TEXTO_2 = { fontSize: "var(--tamano-2)" };
const TEXTO_3 = { fontSize: "var(--tamano-3)" };

/** El fondo suave de la etiqueta de tipo y del resalte del término en las
 * frases de contexto: --acento al 15%, la misma fórmula que ya usa
 * SesionRepaso.tsx para no inventar ningún color nuevo. */
const FONDO_ACENTO_SUAVE = "color-mix(in srgb, var(--acento) 15%, transparent)";

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

type Trozo = { texto: string; resaltado: boolean };

/**
 * Parte una frase para poder resaltar el término dentro de ella. Mismo
 * algoritmo que `partirPorTermino` en SesionRepaso.tsx (no se comparte
 * módulo porque esta tarea solo toca TermTable.tsx y page.tsx): ignora
 * mayúsculas, y si el término no aparece tal cual (por ejemplo conjugado
 * dentro de la frase) la devuelve entera sin resaltar.
 */
function partirPorTermino(frase: string, termino: string): Trozo[] {
  const aguja = termino.trim().toLowerCase();
  if (!aguja) return [{ texto: frase, resaltado: false }];

  const pajar = frase.toLowerCase();
  const trozos: Trozo[] = [];
  let desde = 0;
  for (;;) {
    const encontrado = pajar.indexOf(aguja, desde);
    if (encontrado === -1) break;
    if (encontrado > desde) {
      trozos.push({ texto: frase.slice(desde, encontrado), resaltado: false });
    }
    trozos.push({ texto: frase.slice(encontrado, encontrado + aguja.length), resaltado: true });
    desde = encontrado + aguja.length;
  }
  if (desde < frase.length) trozos.push({ texto: frase.slice(desde), resaltado: false });
  return trozos;
}

function FraseConTerminoResaltado({ frase, termino }: { frase: string; termino: string }) {
  return (
    <p style={TEXTO_1} className="italic text-texto-suave">
      {partirPorTermino(frase, termino).map((trozo, indice) =>
        trozo.resaltado ? (
          <mark
            key={indice}
            className="rounded-control px-1 font-semibold not-italic text-texto"
            style={{ backgroundColor: FONDO_ACENTO_SUAVE }}
          >
            {trozo.texto}
          </mark>
        ) : (
          <span key={indice}>{trozo.texto}</span>
        ),
      )}
    </p>
  );
}

type OpcionFiltro = { value: string; label: string };

/** Un filtro como grupo de botones en vez de un desplegable suelto: cada
 * opción es un botón de alternar (con aria-pressed), reutilizando el
 * componente Boton en vez de inventar un estilo de píldora nuevo. */
function GrupoFiltro({
  etiqueta,
  opciones,
  valor,
  onChange,
}: {
  etiqueta: string;
  opciones: OpcionFiltro[];
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span style={TEXTO_1} className="font-medium text-texto-suave">
        {etiqueta}
      </span>
      <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-2">
        {opciones.map((opcion) => (
          <Boton
            key={opcion.value}
            type="button"
            variante={valor === opcion.value ? "primario" : "secundario"}
            aria-pressed={valor === opcion.value}
            onClick={() => onChange(opcion.value)}
          >
            {opcion.label}
          </Boton>
        ))}
      </div>
    </div>
  );
}

export function TermTable() {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Instantánea sin filtros: es lo que puebla los grupos de filtro, para que
  // sigan ofreciendo todas las fuentes aunque el filtro actual deje la lista
  // vacía.
  const [everything, setEverything] = useState<TermRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // Qué campos se acaban de guardar con éxito, para que la edición en línea
  // deje claro cuándo se ha guardado. Se limpia en cuanto el campo se vuelve
  // a tocar (ver setDraft) o al empezar un nuevo intento de guardado.
  const [guardados, setGuardados] = useState<Record<string, boolean>>({});

  const { search, source, level, type } = filters;

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

  // Efecto aparte, con su propio guard: puebla los grupos de filtro una sola
  // vez al montar, y no debe pisar ni ser pisado por las cargas de `rows` de
  // arriba.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const options = await fetchTerms({});
        if (!cancelled) setEverything(options);
      } catch {
        // Si esto falla, la carga principal ya avisa del error; los grupos
        // de filtro se quedan con lo último que se supo.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Vuelve a leer del servidor sin pasar por "Cargando", para no tapar el error. */
  const refresh = useCallback(async () => {
    try {
      setRows(await fetchTerms({ search, source, level, type }));
    } catch {
      setStatus("error");
    }
    try {
      setEverything(await fetchTerms({}));
    } catch {
      // Si esto falla, la carga principal ya avisa del error; los grupos
      // de filtro se quedan con lo último que se supo.
    }
  }, [search, source, level, type]);

  function draftKey(id: number, field: EditableField) {
    return `${id}:${field}`;
  }

  function valueOf(row: TermRow, field: EditableField) {
    return drafts[draftKey(row.id, field)] ?? row[field];
  }

  function setDraft(id: number, field: EditableField, value: string) {
    setDrafts((current) => ({ ...current, [draftKey(id, field)]: value }));
    clearGuardado(id, field);
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

  function markGuardado(id: number, field: EditableField) {
    setGuardados((current) => ({ ...current, [draftKey(id, field)]: true }));
  }

  function clearGuardado(id: number, field: EditableField) {
    setGuardados((current) => {
      const next = { ...current };
      delete next[draftKey(id, field)];
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
    clearGuardado(row.id, field);

    try {
      const response = await fetch(`/api/terms/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) {
        setRowError(row.id, await errorMessage(response));
      } else {
        markGuardado(row.id, field);
      }
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

  const opcionesFuente: OpcionFiltro[] = [
    { value: "", label: "Todas" },
    ...sourceOptions.map((title) => ({ value: title, label: title })),
  ];
  const opcionesNivel: OpcionFiltro[] = [
    { value: "", label: "Todos" },
    ...levelOptions.map((value) => ({ value, label: value })),
  ];
  const opcionesTipo: OpcionFiltro[] = [
    { value: "", label: "Todos" },
    ...typeOptions.map((value) => ({ value, label: TYPE_LABELS[value] ?? value })),
  ];

  const hayFiltrosActivos = Boolean(search || source || level || type);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Campo
          id="busqueda-biblioteca"
          etiqueta="Buscar"
          value={search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setFilters({ ...filters, search: event.target.value })
          }
        />
        <GrupoFiltro
          etiqueta="Fuente"
          opciones={opcionesFuente}
          valor={source}
          onChange={(value) => setFilters({ ...filters, source: value })}
        />
        <GrupoFiltro
          etiqueta="Nivel"
          opciones={opcionesNivel}
          valor={level}
          onChange={(value) => setFilters({ ...filters, level: value })}
        />
        <GrupoFiltro
          etiqueta="Tipo"
          opciones={opcionesTipo}
          valor={type}
          onChange={(value) => setFilters({ ...filters, type: value })}
        />
      </div>

      {status === "loading" && (
        <p style={TEXTO_2} className="text-texto-suave">
          Cargando vocabulario…
        </p>
      )}

      {status === "error" && (
        <p role="alert" style={TEXTO_2} className="rounded-control border border-peligro p-4 text-peligro">
          No se pudo cargar el vocabulario. Inténtalo de nuevo más tarde.
        </p>
      )}

      {status === "loaded" && (
        <>
          <ul className="flex flex-col gap-4">
            {rows.map((row) => (
              <li key={row.id}>
                <Tarjeta className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <input
                      value={valueOf(row, "term")}
                      onChange={(event) => setDraft(row.id, "term", event.target.value)}
                      onBlur={(event) => void save(row, "term", event.target.value)}
                      aria-label="Término"
                      style={TEXTO_3}
                      className="min-h-12 min-w-0 flex-1 rounded-control border border-borde bg-superficie px-4 font-serif font-semibold text-texto"
                    />
                    <Boton
                      type="button"
                      variante="peligro"
                      onClick={() => void remove(row.id)}
                      className="shrink-0"
                    >
                      Borrar
                    </Boton>
                  </div>
                  {guardados[draftKey(row.id, "term")] && (
                    <p style={TEXTO_1} className="-mt-2 text-texto-suave">
                      Guardado
                    </p>
                  )}

                  <Campo
                    id={`traduccion-${row.id}`}
                    etiqueta="Traducción"
                    value={valueOf(row, "translation")}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDraft(row.id, "translation", event.target.value)
                    }
                    onBlur={(event: React.FocusEvent<HTMLInputElement>) =>
                      void save(row, "translation", event.target.value)
                    }
                    ayuda={guardados[draftKey(row.id, "translation")] ? "Guardado" : undefined}
                  />

                  <div className="flex flex-wrap gap-2">
                    <select
                      value={row.type}
                      onChange={(event) => void save(row, "type", event.target.value)}
                      aria-label="Tipo"
                      style={{ ...TEXTO_1, backgroundColor: FONDO_ACENTO_SUAVE }}
                      className="min-h-12 rounded-control border-none px-3 font-medium text-texto"
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
                      style={TEXTO_1}
                      className="min-h-12 rounded-control border border-borde bg-transparent px-3 text-texto-suave"
                    >
                      {CEFR_LEVELS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(guardados[draftKey(row.id, "type")] ||
                    guardados[draftKey(row.id, "level")]) && (
                    <p style={TEXTO_1} className="-mt-2 text-texto-suave">
                      Guardado
                    </p>
                  )}

                  {rowErrors[row.id] && (
                    <p
                      role="alert"
                      style={TEXTO_1}
                      className="rounded-control border border-peligro p-3 text-peligro"
                    >
                      {rowErrors[row.id]}
                    </p>
                  )}

                  {row.sources.length > 0 && (
                    <p style={TEXTO_1} className="text-texto-suave">
                      De: {row.sources.join(", ")}
                    </p>
                  )}

                  {row.contexts.length > 0 && (
                    <div className="flex flex-col gap-1 border-t border-borde pt-3">
                      {row.contexts.map((context, index) => (
                        <FraseConTerminoResaltado key={index} frase={context} termino={row.term} />
                      ))}
                    </div>
                  )}
                </Tarjeta>
              </li>
            ))}
          </ul>
          {rows.length === 0 && (
            <p style={TEXTO_2} className="text-texto-suave">
              {hayFiltrosActivos
                ? "Ningún término coincide con estos filtros."
                : "Todavía no hay vocabulario guardado."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
