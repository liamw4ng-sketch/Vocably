# El español del diccionario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a Vocably un origen propio y gratuito de significados en español —el volcado del Wikcionario español— y arreglar los dos fallos que hacen que el que ya hay (MyMemory) funcione mal.

**Architecture:** Una tabla nueva, `spanish_meanings`, guarda el español **de la palabra** (una fila por palabra y categoría gramatical), alimentada por dos orígenes: el volcado español y MyMemory. `dictionary_entries.translations` se queda como está y sigue guardando el español **de la acepción**, que es lo que escribe *afinar con IA*. Esa separación de niveles es la que disuelve el fallo del caché: MyMemory contestaba a «qué significa esta palabra» y se le estaba guardando en el sitio de «qué significa esta acepción».

**Tech Stack:** Next.js 16.3.4 (App Router), TypeScript estricto, Drizzle ORM sobre Neon Postgres, Vitest con PGlite en memoria, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-09-espanol-del-diccionario-design.md`

## Global Constraints

- **Español en todo el código que escribas.** Nombres de funciones, variables, tipos, comentarios, mensajes de error y textos de pantalla. Los nombres de columna de la base van en inglés (`term_normalized`, `session_size`), que es la convención ya establecida en `db/schema.ts`.
- **TDD sin excepciones.** Prueba primero, verla fallar, implementación mínima, verla pasar, commit. Está en `AGENTS.md` del proyecto y en la skill `superpowers:test-driven-development`.
- **Las pruebas corren en `environment: "node"`, sin jsdom y sin `@testing-library`.** Es deliberado: la lógica que puede fallar se extrae del componente como función pura exportada y se prueba así. **No añadas jsdom ni testing-library.**
- **Cero `eslint-disable` en el proyecto.** Si una regla te molesta, rediseña; no la silencies.
- **NUNCA ejecutes `npx prettier`.** No es dependencia del proyecto ni hay configuración: reformatearía ficheros enteros.
- **Ejecuta `npm test` (son ~440 pruebas, unos 40 s), `npx tsc --noEmit` y `npx eslint .` antes de cada commit.**
- **No apliques nada a la base de datos real.** Las migraciones a producción las lanza el usuario a mano. Tú solo generas el fichero `.sql`.
- **El correo del usuario no se manda a MyMemory** aunque duplique la cuota. Es una decisión de privacidad ya tomada.
- Este version de Next tiene cambios que quizá no conozcas: si tocas algo del framework, lee la guía correspondiente en `node_modules/next/dist/docs/`.

---

## Estructura de ficheros

**Se crean:**

| Fichero | Responsabilidad |
|---|---|
| `lib/diccionario/espanol.ts` | Puro: leer una línea del volcado español, y los dos topes (8 al guardar, 5 al enseñar). Sin base de datos. |
| `db/repository/espanol.ts` | Todo lo que toca `spanish_meanings`: cargar, buscar, completar con el traductor. Fichero aparte para que `diccionario.ts` (231 líneas) no siga creciendo. |
| `scripts/cargar-espanol.ts` | El cargador de línea de órdenes, hermano de `cargar-diccionario.ts`. |
| `tests/diccionario/espanol.test.ts` | Pruebas del módulo puro. |
| `tests/db/espanol-carga.test.ts` | Pruebas de la carga, con PGlite. |
| `tests/db/espanol-busqueda.test.ts` | Pruebas de la búsqueda y del escalón de MyMemory, con PGlite. |
| `drizzle/0006_*.sql` | La migración. La genera `drizzle-kit`, no se escribe a mano. |

**Se modifican:**

| Fichero | Cambio |
|---|---|
| `db/schema.ts` | La tabla `spanishMeanings`. |
| `lib/diccionario/traductor.ts` | Comprobar la cuota antes de creerse la respuesta. |
| `db/repository/diccionario.ts` | Se va `traducirSiFalta`; su trabajo pasa a `espanol.ts`. |
| `app/api/diccionario/route.ts` | La respuesta gana `significados`. |
| `components/BuscadorDiccionario.tsx` | El bloque de significados en español, el inglés plegado, y la precedencia al añadir. |
| `package.json` | El script `cargar:espanol`. |
| `tests/diccionario/traductor.test.ts` | Pruebas de la cuota. |
| `tests/db/diccionario-traduccion.test.ts` | Se sustituye por las de `espanol-busqueda`. |
| `tests/api/diccionario.test.ts` | El campo nuevo de la respuesta. |
| `tests/buscador-diccionario.test.ts` | Las funciones puras nuevas y las que cambian de forma. |
| `README.md` | Cómo cargar el diccionario español. |

---

### Task 1: La tabla `spanish_meanings`

**Files:**
- Modify: `db/schema.ts` (al final del fichero)
- Create: `drizzle/0006_*.sql` (generado por drizzle-kit)
- Test: `tests/db/espanol-schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `spanishMeanings` exportado de `@/db/schema`, con columnas `id`, `termNormalized`, `term`, `pos`, `meanings` (`text[]`), `source`; índice único sobre `(term_normalized, pos)`.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/espanol-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { spanishMeanings } from "@/db/schema";

describe("spanish_meanings", () => {
  it("guarda una palabra con su categoría y sus significados", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "language",
      term: "language",
      pos: "noun",
      meanings: ["Idioma.", "Lengua, lenguaje."],
      source: "wikcionario-es",
    });

    const [fila] = await db.select().from(spanishMeanings);
    expect(fila.term).toBe("language");
    expect(fila.meanings).toEqual(["Idioma.", "Lengua, lenguaje."]);
    expect(fila.source).toBe("wikcionario-es");
    await close();
  });

  /**
   * La misma palabra en dos categorías son dos filas: `dog` sustantivo no
   * significa lo mismo que `dog` verbo.
   */
  it("deja la misma palabra en dos categorías distintas", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
      { termNormalized: "dog", term: "dog", pos: "verb", meanings: ["Acosar."], source: "wikcionario-es" },
    ]);

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });

  /**
   * El único es lo que hace que volver a cargar el volcado actualice en vez de
   * duplicar. Sin él, cada carga añadiría 21.000 filas más.
   */
  it("rechaza la misma palabra y categoría dos veces", async () => {
    const { db, close } = await createTestDb();
    const fila = {
      termNormalized: "dog",
      term: "dog",
      pos: "noun",
      meanings: ["Perro."],
      source: "wikcionario-es",
    };
    await db.insert(spanishMeanings).values(fila);

    await expect(db.insert(spanishMeanings).values(fila)).rejects.toThrow();
    await close();
  });

  /**
   * MyMemory traduce la palabra sin decir de qué categoría habla, así que sus
   * filas ocupan la categoría vacía y nunca chocan con las de Wikcionario.
   */
  it("la categoría vacía de MyMemory convive con la de Wikcionario", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "turn down", term: "turn down", pos: "verb", meanings: ["Rechazar."], source: "wikcionario-es" },
      { termNormalized: "turn down", term: "turn down", pos: "", meanings: ["rechazar"], source: "mymemory" },
    ]);

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/espanol-schema.test.ts`
Esperado: FALLA con algo como `"spanishMeanings" is not exported by "db/schema.ts"`.

- [ ] **Step 3: Añade la tabla al esquema**

Al final de `db/schema.ts`, después de `dictionaryEntries`:

```ts
/**
 * El español **de una palabra**, no de una acepción: una fila por palabra y
 * categoría gramatical, con su lista ordenada de significados.
 *
 * Deliberadamente separada de `dictionary_entries`. Los dos Wikcionarios son
 * obras independientes y no numeran igual sus acepciones, así que colgar los
 * significados españoles de las acepciones inglesas daría a entender una
 * correspondencia que no existe. Y es justo la raíz del fallo que esto arregla:
 * MyMemory contesta "qué significa esta palabra" y se le estaba guardando en el
 * sitio de "qué significa esta acepción".
 *
 * `dictionary_entries.translations` sigue guardando lo segundo, que es lo que
 * escribe *afinar con IA*.
 */
export const spanishMeanings = pgTable(
  "spanish_meanings",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    /**
     * Categoría gramatical tal como la nombra Wikcionario. **Cadena vacía** en
     * lo que viene de MyMemory, que traduce la palabra sin decir de qué
     * categoría habla; así sus filas nunca chocan con las de Wikcionario en el
     * índice único de abajo.
     */
    pos: text("pos").notNull(),
    /** Los significados en español, en el orden del original. */
    meanings: text("meanings").array().notNull().default([]),
    /** `wikcionario-es` | `mymemory`. */
    source: text("source").notNull(),
  },
  (table) => ({
    // Es también lo que hace que recargar el volcado actualice en vez de duplicar.
    terminoPosIdx: uniqueIndex("spanish_meanings_term_pos_idx").on(
      table.termNormalized,
      table.pos,
    ),
  }),
);
```

`serial`, `text` y `uniqueIndex` ya están importados arriba del fichero; no toques los imports.

- [ ] **Step 4: Genera la migración**

Ejecuta: `npx drizzle-kit generate`
Esperado: crea `drizzle/0006_<nombre>.sql` con un `CREATE TABLE "spanish_meanings"` y un `CREATE UNIQUE INDEX`, más su entrada en `drizzle/meta/_journal.json` y su snapshot.

No debe preguntarte nada: una tabla nueva no tiene ambigüedad de renombrado. **Si te pregunta algo, para y avisa** — significa que drizzle ha visto un cambio que no esperabas.

Abre el `.sql` generado y comprueba que solo crea la tabla y su índice. No debe tocar ninguna otra tabla.

- [ ] **Step 5: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/espanol-schema.test.ts`
Esperado: PASA, 4 pruebas. PGlite aplica las migraciones de `./drizzle`, así que la tabla existe porque el paso 4 generó el fichero.

- [ ] **Step 6: Comprueba que no has roto nada y haz commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add db/schema.ts drizzle/ tests/db/espanol-schema.test.ts
git commit -m "Añadir la tabla del español de la palabra"
```

---

### Task 2: Leer una línea del volcado español

**Files:**
- Create: `lib/diccionario/espanol.ts`
- Test: `tests/diccionario/espanol.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` de `@/lib/normalize`.
- Produces:
  - `export type FilaEspanola = { termNormalized: string; term: string; pos: string; meanings: string[] }`
  - `export const MAXIMO_SIGNIFICADOS_GUARDADOS = 8`
  - `export const MAXIMO_SIGNIFICADOS_MOSTRADOS = 5`
  - `export function filaDeLineaEspanola(linea: string): FilaEspanola | null`

**Contexto:** el fichero `dicc_es.jsonl.gz` lo produjo `~/Vocably-diccionario/filtrar_es.py`. Cada línea es `{"w": palabra, "p": categoría, "s": [significado, ...]}`, donde **`s` es una lista de cadenas**, no de objetos. (En el volcado inglés `s` sí es una lista de objetos; no confundas los dos formatos.)

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/diccionario/espanol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filaDeLineaEspanola, MAXIMO_SIGNIFICADOS_GUARDADOS } from "@/lib/diccionario/espanol";

const language = JSON.stringify({
  w: "language",
  p: "noun",
  s: ["Idioma.", "Lengua, lenguaje.", "Léxico, jerga, vocabulario."],
});

describe("filaDeLineaEspanola", () => {
  it("saca la palabra, su categoría y sus significados en orden", () => {
    expect(filaDeLineaEspanola(language)).toEqual({
      termNormalized: "language",
      term: "language",
      pos: "noun",
      meanings: ["Idioma.", "Lengua, lenguaje.", "Léxico, jerga, vocabulario."],
    });
  });

  /**
   * La clave de comparación se normaliza igual que en el resto del proyecto,
   * porque es con lo que se busca: sin esto, "Come Across" no encontraría nada.
   */
  it("normaliza la clave pero conserva la palabra tal como se escribe", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "  Come   Across ", p: "verb", s: ["Encontrarse."] }));
    expect(fila?.termNormalized).toBe("come across");
    expect(fila?.term).toBe("Come   Across");
  });

  it("recorta a ocho significados", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => `Significado ${i + 1}.`);
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "set", p: "verb", s: nueve }));
    expect(fila?.meanings).toHaveLength(MAXIMO_SIGNIFICADOS_GUARDADOS);
    expect(fila?.meanings.at(-1)).toBe("Significado 8.");
  });

  /**
   * Una línea mala no puede tumbar una carga de 21.000: se salta y ya. Es la
   * misma decisión que en `filasDeLinea` del volcado inglés.
   */
  it("devuelve null en vez de reventar con una línea que no sirve", () => {
    expect(filaDeLineaEspanola("{ esto no es json")).toBeNull();
    expect(filaDeLineaEspanola("null")).toBeNull();
    expect(filaDeLineaEspanola("")).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun" }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: [] }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "", p: "noun", s: ["Perro."] }))).toBeNull();
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "", s: ["Perro."] }))).toBeNull();
  });

  it("descarta los significados vacíos y no cuenta la entrada si no queda ninguno", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["", "  ", "Perro."] }));
    expect(fila?.meanings).toEqual(["Perro."]);
    expect(filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["", "  "] }))).toBeNull();
  });

  it("ignora los significados que no son cadenas", () => {
    const fila = filaDeLineaEspanola(JSON.stringify({ w: "dog", p: "noun", s: ["Perro.", 42, null] }));
    expect(fila?.meanings).toEqual(["Perro."]);
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/diccionario/espanol.test.ts`
Esperado: FALLA con `Failed to resolve import "@/lib/diccionario/espanol"`.

- [ ] **Step 3: Escribe el módulo**

Crea `lib/diccionario/espanol.ts`:

```ts
import { normalizeTerm } from "@/lib/normalize";

/**
 * Cuántos significados se guardan por palabra y categoría. El fichero filtrado
 * ya trae hasta ocho; recortar más al cargar ahorraría kilobytes y costaría una
 * descarga de 95 MB el día que se quieran seis en pantalla.
 */
export const MAXIMO_SIGNIFICADOS_GUARDADOS = 8;

/** Cuántos se enseñan. Es lo que pidió el usuario. */
export const MAXIMO_SIGNIFICADOS_MOSTRADOS = 5;

export type FilaEspanola = {
  termNormalized: string;
  term: string;
  pos: string;
  meanings: string[];
};

type LineaCruda = {
  w?: unknown;
  p?: unknown;
  s?: unknown;
};

/**
 * Una línea del volcado del Wikcionario español se convierte en una fila.
 *
 * Formato: `{"w": palabra, "p": categoría, "s": [significado, ...]}`, donde `s`
 * es una lista de **cadenas**. Ojo: en el volcado inglés `s` es una lista de
 * objetos (`lib/diccionario/entrada.ts`). Son dos formatos distintos.
 *
 * Devuelve `null` en vez de lanzar: una línea ilegible no puede abortar una
 * carga de 21.000.
 */
export function filaDeLineaEspanola(linea: string): FilaEspanola | null {
  let cruda: LineaCruda;
  try {
    cruda = JSON.parse(linea) as LineaCruda;
  } catch {
    return null;
  }

  // JSON.parse devuelve también null, números y cadenas: hace falta un objeto.
  if (typeof cruda !== "object" || cruda === null) return null;

  const term = typeof cruda.w === "string" ? cruda.w.trim() : "";
  const pos = typeof cruda.p === "string" ? cruda.p.trim() : "";
  if (!term || !pos || !Array.isArray(cruda.s)) return null;

  const meanings: string[] = [];
  for (const significado of cruda.s) {
    if (typeof significado !== "string") continue;
    const limpio = significado.trim();
    if (!limpio) continue;
    meanings.push(limpio);
    if (meanings.length === MAXIMO_SIGNIFICADOS_GUARDADOS) break;
  }
  if (meanings.length === 0) return null;

  return { termNormalized: normalizeTerm(term), term, pos, meanings };
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/diccionario/espanol.test.ts`
Esperado: PASA, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add lib/diccionario/espanol.ts tests/diccionario/espanol.test.ts
git commit -m "Leer una línea del volcado del Wikcionario español"
```

---

### Task 3: Cargar el volcado en la base

**Files:**
- Create: `db/repository/espanol.ts`
- Create: `scripts/cargar-espanol.ts`
- Modify: `package.json` (scripts)
- Modify: `README.md`
- Test: `tests/db/espanol-carga.test.ts`

**Interfaces:**
- Consumes: `filaDeLineaEspanola`, `FilaEspanola` de `@/lib/diccionario/espanol`; `spanishMeanings` de `@/db/schema`; `Database` de `@/db/types`; `lineasDeFicheroGz` de `@/lib/diccionario/lineas`.
- Produces:
  - `export const ORIGEN_WIKCIONARIO_ES = "wikcionario-es"`
  - `export const ORIGEN_MYMEMORY = "mymemory"`
  - `export async function cargarEspanol(db: Database, lineas: AsyncIterable<string>, opciones?: { tamanoLote?: number }): Promise<{ entradas: number }>`

**Diferencia importante con `cargarDiccionario`:** aquel **vacía la tabla** antes de cargar. Este **no puede**, porque en la misma tabla viven las filas de MyMemory, que son cuota ya gastada. Es un *upsert* por `(term_normalized, pos)`.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/espanol-carga.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarEspanol, ORIGEN_MYMEMORY, ORIGEN_WIKCIONARIO_ES } from "@/db/repository/espanol";
import { spanishMeanings } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

const language = JSON.stringify({ w: "language", p: "noun", s: ["Idioma.", "Lengua, lenguaje."] });
const dogSustantivo = JSON.stringify({ w: "dog", p: "noun", s: ["Perro."] });
const dogVerbo = JSON.stringify({ w: "dog", p: "verb", s: ["Acosar."] });

describe("cargarEspanol", () => {
  it("guarda una fila por palabra y categoría, marcada con su origen", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarEspanol(db, lineasDe(language, dogSustantivo, dogVerbo));

    expect(resultado).toEqual({ entradas: 3 });
    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.source === ORIGEN_WIKCIONARIO_ES)).toBe(true);
    await close();
  });

  it("salta las líneas que no sirven sin abortar la carga", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarEspanol(db, lineasDe(language, "{ roto", "", dogSustantivo));

    expect(resultado).toEqual({ entradas: 2 });
    await close();
  });

  it("recargar el mismo fichero no duplica: actualiza", async () => {
    const { db, close } = await createTestDb();
    await cargarEspanol(db, lineasDe(language));
    await cargarEspanol(db, lineasDe(JSON.stringify({ w: "language", p: "noun", s: ["Idioma.", "Otro."] })));

    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(1);
    expect(filas[0].meanings).toEqual(["Idioma.", "Otro."]);
    await close();
  });

  /**
   * Lo que trajo MyMemory es cuota ya gastada y vive en la categoría vacía.
   * Una carga del volcado no puede llevárselo por delante: si lo hiciera, cada
   * recarga del diccionario obligaría a volver a pagar en caracteres.
   */
  it("no toca las filas de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "turn down",
      term: "turn down",
      pos: "",
      meanings: ["rechazar"],
      source: ORIGEN_MYMEMORY,
    });

    await cargarEspanol(db, lineasDe(JSON.stringify({ w: "turn down", p: "verb", s: ["Rechazar."] })));

    const filas = await db.select().from(spanishMeanings);
    expect(filas).toHaveLength(2);
    const deMyMemory = filas.find((f) => f.source === ORIGEN_MYMEMORY);
    expect(deMyMemory?.meanings).toEqual(["rechazar"]);
    await close();
  });

  it("escribe por lotes sin perder ninguna entrada", async () => {
    const { db, close } = await createTestDb();
    const muchas = Array.from({ length: 7 }, (_, i) =>
      JSON.stringify({ w: `palabra${i}`, p: "noun", s: [`Significado ${i}.`] }),
    );

    const resultado = await cargarEspanol(db, lineasDe(...muchas), { tamanoLote: 2 });

    expect(resultado).toEqual({ entradas: 7 });
    expect(await db.select().from(spanishMeanings)).toHaveLength(7);
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/espanol-carga.test.ts`
Esperado: FALLA con `Failed to resolve import "@/db/repository/espanol"`.

- [ ] **Step 3: Escribe el repositorio**

Crea `db/repository/espanol.ts`:

```ts
import { sql } from "drizzle-orm";
import { spanishMeanings } from "@/db/schema";
import type { Database } from "@/db/types";
import { filaDeLineaEspanola, type FilaEspanola } from "@/lib/diccionario/espanol";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/** El volcado del Wikcionario español: un diccionario escrito por personas. */
export const ORIGEN_WIKCIONARIO_ES = "wikcionario-es";
/** El traductor automático gratuito. */
export const ORIGEN_MYMEMORY = "mymemory";

/**
 * Carga el volcado español en `spanish_meanings`.
 *
 * **No vacía la tabla**, a diferencia de `cargarDiccionario`. En esta misma
 * tabla viven las filas de MyMemory, que son cuota ya gastada: borrarlas
 * obligaría a volver a pagarlas en caracteres cada vez que se recargue el
 * diccionario. Es un upsert por (término, categoría), y las de MyMemory no
 * chocan nunca porque ocupan la categoría vacía.
 */
export async function cargarEspanol(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  return db.transaction(async (tx) => {
    let entradas = 0;
    let lote: FilaEspanola[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      await tx
        .insert(spanishMeanings)
        .values(lote.map((fila) => ({ ...fila, source: ORIGEN_WIKCIONARIO_ES })))
        .onConflictDoUpdate({
          target: [spanishMeanings.termNormalized, spanishMeanings.pos],
          set: {
            term: sql`excluded.term`,
            meanings: sql`excluded.meanings`,
            source: sql`excluded.source`,
          },
        });
      entradas += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const fila = filaDeLineaEspanola(linea);
      if (!fila) continue;
      lote.push(fila);
      if (lote.length >= tamanoLote) await vaciarLote();
    }
    await vaciarLote();

    return { entradas };
  });
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/espanol-carga.test.ts`
Esperado: PASA, 5 pruebas.

Si alguna falla con `ON CONFLICT DO UPDATE command cannot affect row a second time`, es que un mismo lote trae dos veces la misma (palabra, categoría). El fichero real no lo hace y por eso no se blinda de antemano; si te pasa, **escribe primero esta prueba** y luego deduplica el lote por `${termNormalized}\u0000${pos}` quedándote con la última:

```ts
it("dos veces la misma palabra y categoría en el mismo lote no revientan la carga", async () => {
  const { db, close } = await createTestDb();
  const repetida = JSON.stringify({ w: "dog", p: "noun", s: ["Perro."] });

  await cargarEspanol(db, lineasDe(repetida, repetida), { tamanoLote: 10 });

  expect(await db.select().from(spanishMeanings)).toHaveLength(1);
  await close();
});
```

- [ ] **Step 5: Escribe el script de carga**

Crea `scripts/cargar-espanol.ts`:

```ts
import { cargarEspanol } from "@/db/repository/espanol";
import { lineasDeFicheroGz } from "@/lib/diccionario/lineas";
import { getDb } from "@/db/client";

/**
 * Carga el diccionario español en la base apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-espanol.ts ~/Vocably-diccionario/dicc_es.jsonl.gz
 *
 * Se ejecuta a mano, una vez. No forma parte del arranque de la aplicación ni
 * del despliegue.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del fichero .jsonl.gz del diccionario español.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  // Perezosa a propósito: `cargarEspanol` no empieza a leer hasta haber abierto
  // la transacción. Ver `lineasDeFicheroGz`.
  const inicio = Date.now();
  const { entradas } = await cargarEspanol(getDb(), lineasDeFicheroGz(ruta));
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

En `package.json`, junto a `cargar:diccionario`:

```json
"cargar:espanol": "tsx scripts/cargar-espanol.ts"
```

- [ ] **Step 6: Documenta la carga**

En `README.md`, en la sección donde se explica cargar el diccionario, añade debajo:

```markdown
### El diccionario español

Los significados en español salen del volcado del Wikcionario **español**, que es
otro fichero distinto del inglés. Se produce con `~/Vocably-diccionario/filtrar_es.py`,
que filtra el volcado de kaikki.org mientras se descarga (los 95 MB no se guardan):

```bash
curl -s https://kaikki.org/dictionary/downloads/es/es-extract.jsonl.gz | gunzip | python3 filtrar_es.py
```

Y se carga con:

```bash
DATABASE_URL='...' npm run cargar:espanol -- ~/Vocably-diccionario/dicc_es.jsonl.gz
```

Es idempotente: volver a cargarlo actualiza en vez de duplicar, y no toca las
traducciones que ya trajo MyMemory.
```

- [ ] **Step 7: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add db/repository/espanol.ts scripts/cargar-espanol.ts package.json README.md tests/db/espanol-carga.test.ts
git commit -m "Cargar el diccionario español sin pisar lo que trajo MyMemory"
```

---

### Task 4: Buscar los significados en español

**Files:**
- Modify: `db/repository/espanol.ts`
- Test: `tests/db/espanol-busqueda.test.ts`

**Interfaces:**
- Consumes: `variantesDelLema` de `@/lib/diccionario/lema`.
- Produces:
  - `export type SignificadosDePalabra = { term: string; pos: string; meanings: string[]; source: string }`
  - `export async function buscarSignificadosEspanoles(db: Database, termino: string): Promise<SignificadosDePalabra[]>`

**La regla que importa:** una palabra puede tener filas de los dos orígenes a la vez. Si hay alguna de Wikcionario, **la de MyMemory no se devuelve** — pero se queda en la base, porque si un día el volcado deja de traer esa palabra, vuelve a servir sin gastar cuota otra vez.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/espanol-busqueda.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import {
  buscarSignificadosEspanoles,
  ORIGEN_MYMEMORY,
  ORIGEN_WIKCIONARIO_ES,
} from "@/db/repository/espanol";
import { spanishMeanings } from "@/db/schema";

describe("buscarSignificadosEspanoles", () => {
  it("devuelve los significados de la palabra, por categoría", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "verb", meanings: ["Acosar."], source: ORIGEN_WIKCIONARIO_ES },
    ]);

    const encontrados = await buscarSignificadosEspanoles(db, "dog");

    expect(encontrados).toHaveLength(2);
    expect(encontrados.map((s) => s.pos).sort()).toEqual(["noun", "verb"]);
    await close();
  });

  it("no devuelve nada de una palabra que no está", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarSignificadosEspanoles(db, "xyzzy")).toEqual([]);
    await close();
  });

  it("busca con la clave normalizada", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "come across", term: "come across", pos: "verb",
      meanings: ["Encontrarse."], source: ORIGEN_WIKCIONARIO_ES,
    });

    expect(await buscarSignificadosEspanoles(db, "  Come   Across ")).toHaveLength(1);
    await close();
  });

  /**
   * Wikcionario lematiza los idioms con "one" y la gente los escribe con "you".
   * La misma regla que ya usa la búsqueda del diccionario inglés.
   */
  it("prueba las variantes del lema", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "bite off more than one can chew", term: "bite off more than one can chew",
      pos: "verb", meanings: ["Abarcar más de lo que se puede."], source: ORIGEN_WIKCIONARIO_ES,
    });

    const encontrados = await buscarSignificadosEspanoles(db, "bite off more than you can chew");
    expect(encontrados).toHaveLength(1);
    await close();
  });

  /**
   * Teniendo el diccionario, la traducción automática sobra en pantalla: decir
   * las dos cosas a la vez es ruido, y la escrita por personas es mejor.
   */
  it("con Wikcionario delante, no devuelve lo de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "", meanings: ["perro"], source: ORIGEN_MYMEMORY },
    ]);

    const encontrados = await buscarSignificadosEspanoles(db, "dog");

    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].source).toBe(ORIGEN_WIKCIONARIO_ES);
    await close();
  });

  it("pero sin Wikcionario, sí devuelve lo de MyMemory", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values({
      termNormalized: "turn down", term: "turn down", pos: "",
      meanings: ["rechazar"], source: ORIGEN_MYMEMORY,
    });

    const encontrados = await buscarSignificadosEspanoles(db, "turn down");

    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].source).toBe(ORIGEN_MYMEMORY);
    await close();
  });

  it("la fila de MyMemory descartada sigue en la base", async () => {
    const { db, close } = await createTestDb();
    await db.insert(spanishMeanings).values([
      { termNormalized: "dog", term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
      { termNormalized: "dog", term: "dog", pos: "", meanings: ["perro"], source: ORIGEN_MYMEMORY },
    ]);

    await buscarSignificadosEspanoles(db, "dog");

    expect(await db.select().from(spanishMeanings)).toHaveLength(2);
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/espanol-busqueda.test.ts`
Esperado: FALLA con `buscarSignificadosEspanoles is not a function` o error de importación.

- [ ] **Step 3: Escribe la búsqueda**

En `db/repository/espanol.ts`, añade al final. Antes, en los imports de arriba,
deja la primera línea como `import { eq, sql } from "drizzle-orm";` y añade:

```ts
import { variantesDelLema } from "@/lib/diccionario/lema";
```

Y al final del fichero:

```ts
export type SignificadosDePalabra = {
  term: string;
  pos: string;
  meanings: string[];
  source: string;
};

/**
 * El español de una palabra. Prueba la forma escrita y luego sus variantes de
 * lema, igual que `buscarEnDiccionario`, y se para en la primera que responde.
 *
 * **Teniendo Wikcionario, se descarta lo de MyMemory**: enseñar a la vez un
 * diccionario escrito por personas y una traducción automática de la misma
 * palabra es ruido. La fila descartada no se borra — si mañana el volcado deja
 * de traer la palabra, vuelve a servir sin gastar cuota otra vez.
 */
export async function buscarSignificadosEspanoles(
  db: Database,
  termino: string,
): Promise<SignificadosDePalabra[]> {
  for (const clave of variantesDelLema(termino)) {
    const filas = await db
      .select({
        term: spanishMeanings.term,
        pos: spanishMeanings.pos,
        meanings: spanishMeanings.meanings,
        source: spanishMeanings.source,
      })
      .from(spanishMeanings)
      .where(eq(spanishMeanings.termNormalized, clave))
      .orderBy(spanishMeanings.id);

    if (filas.length === 0) continue;

    const deWikcionario = filas.filter((f) => f.source === ORIGEN_WIKCIONARIO_ES);
    return deWikcionario.length > 0 ? deWikcionario : filas;
  }
  return [];
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/espanol-busqueda.test.ts`
Esperado: PASA, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add db/repository/espanol.ts tests/db/espanol-busqueda.test.ts
git commit -m "Buscar el español de una palabra, con Wikcionario por delante"
```

---

### Task 5: Que MyMemory sepa cuándo se le acabó la cuota

**Files:**
- Modify: `lib/diccionario/traductor.ts`
- Test: `tests/diccionario/traductor.test.ts`

**Interfaces:**
- Produces: `export function cuotaAgotada(cuerpo: unknown): boolean`, exportada para poder probarla suelta. `crearTraductorMyMemory` mantiene su firma actual: `(fetchImpl?: typeof fetch, esperaMs?: number) => Traductor`.

**El fallo:** agotada la cuota diaria, MyMemory responde **HTTP 200** con su aviso metido en `responseData.translatedText`. Hoy ese texto se devolvería como si fuera la traducción al español, y acabaría pintado en pantalla y guardado en una tarjeta.

- [ ] **Step 1: Escribe la prueba que falla**

Añade al final de `describe("crearTraductorMyMemory", ...)` en `tests/diccionario/traductor.test.ts`:

```ts
  /**
   * El fallo que esto arregla: MyMemory contesta **200** con el aviso dentro del
   * campo de la traducción. Sin comprobarlo, "MYMEMORY WARNING: YOU USED ALL
   * AVAILABLE FREE TRANSLATIONS FOR TODAY" acabaría pintado en pantalla como si
   * fuera el español de la palabra, y guardado en una tarjeta de repaso.
   */
  it("con la cuota agotada devuelve vacío, no el aviso del servicio", async () => {
    const cuotaAgotada = {
      responseData: {
        translatedText:
          "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 10 HOURS 26 MINUTES",
      },
      quotaFinished: true,
      responseStatus: 403,
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuotaAgotada)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  it("también cuando el estado viene como cadena", async () => {
    const cuerpo = { responseData: { translatedText: "algo" }, responseStatus: "403" };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  /**
   * MyMemory ha movido `quotaFinished` entre la raíz y `responseData` según la
   * versión, así que se mira en los dos sitios.
   */
  it("también cuando quotaFinished viene dentro de responseData", async () => {
    const cuerpo = {
      responseData: { translatedText: "algo", quotaFinished: true },
      responseStatus: 200,
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual([]);
  });

  /**
   * Cinturón y tirantes: aunque el estado dijera 200 y nadie marcara la cuota,
   * un texto que empieza por la marca del aviso no es una traducción.
   */
  it("descarta las candidatas que traen la marca del aviso", async () => {
    const cuerpo = {
      responseStatus: 200,
      responseData: { translatedText: "MYMEMORY WARNING: something" },
      matches: [{ translation: "perro" }],
    };
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo)));

    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("dog")).toEqual(["perro"]);
  });
```

Y añade un `describe` nuevo, al final del fichero:

```ts
describe("cuotaAgotada", () => {
  it("una respuesta buena no lo está", () => {
    expect(cuotaAgotada({ responseStatus: 200, responseData: { translatedText: "perro" } })).toBe(false);
  });

  it("lo está si el estado no es 200, venga como número o como cadena", () => {
    expect(cuotaAgotada({ responseStatus: 403 })).toBe(true);
    expect(cuotaAgotada({ responseStatus: "403" })).toBe(true);
  });

  it("lo está si alguien marca quotaFinished, en la raíz o dentro", () => {
    expect(cuotaAgotada({ responseStatus: 200, quotaFinished: true })).toBe(true);
    expect(cuotaAgotada({ responseStatus: 200, responseData: { quotaFinished: true } })).toBe(true);
  });

  /**
   * Sin estado no se puede afirmar que la cuota esté agotada. El camino de un
   * cuerpo raro ya está cubierto: sin traducciones utilizables se devuelve
   * vacío igual.
   */
  it("un cuerpo sin estado no se da por agotado", () => {
    expect(cuotaAgotada({})).toBe(false);
    expect(cuotaAgotada(null)).toBe(false);
  });
});
```

Añade `cuotaAgotada` al import de arriba del fichero.

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/diccionario/traductor.test.ts`
Esperado: FALLA. La primera prueba nueva falla porque devuelve `["MYMEMORY WARNING: …"]` en vez de `[]`, y las de `cuotaAgotada` fallan al importar.

**Fíjate en ese primer fallo:** es literalmente el aviso del servicio haciéndose pasar por la traducción. Eso es lo que arreglas.

- [ ] **Step 3: Escribe el arreglo**

En `lib/diccionario/traductor.ts`, antes de `crearTraductorMyMemory`:

```ts
/** La marca con la que MyMemory empieza sus avisos. */
const AVISO = "MYMEMORY WARNING";

type CuerpoMyMemory = {
  responseStatus?: unknown;
  quotaFinished?: unknown;
  responseData?: { translatedText?: unknown; quotaFinished?: unknown };
  matches?: { translation?: unknown }[];
};

/**
 * Si esta respuesta es la de "se te acabó la cuota diaria".
 *
 * Hace falta porque MyMemory la manda con **HTTP 200**: el aviso viaja dentro
 * de `responseData.translatedText`, en el mismo sitio donde vendría la
 * traducción. Sin esto, "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE
 * TRANSLATIONS FOR TODAY" se enseñaría como el español de la palabra.
 *
 * `responseStatus` llega unas veces como número y otras como cadena, y
 * `quotaFinished` ha estado en la raíz y dentro de `responseData` según la
 * versión: se miran los dos sitios y las dos formas.
 */
export function cuotaAgotada(cuerpo: unknown): boolean {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  const { responseStatus, quotaFinished, responseData } = cuerpo as CuerpoMyMemory;

  if (quotaFinished === true || responseData?.quotaFinished === true) return true;

  // Sin estado no se puede afirmar nada: se deja pasar y que decida el filtro
  // de candidatas de abajo.
  if (responseStatus === undefined || responseStatus === null) return false;
  return Number(responseStatus) !== 200;
}
```

Dentro del `traductor` devuelto, justo después de leer el cuerpo:

```ts
      const cuerpo = (await res.json()) as CuerpoMyMemory;
      if (cuotaAgotada(cuerpo)) return [];

      const candidatas = [
        typeof cuerpo.responseData?.translatedText === "string" ? cuerpo.responseData.translatedText : "",
        ...(cuerpo.matches ?? []).map((m) => (typeof m.translation === "string" ? m.translation : "")),
      ];
```

Y dentro del bucle que limpia candidatas, junto a la comprobación de vacío:

```ts
        const limpia = bruta.trim();
        // Cinturón y tirantes: aunque el estado dijera 200, un texto que empieza
        // por la marca del aviso no es una traducción.
        if (!limpia || limpia.startsWith(AVISO) || vistas.has(limpia.toLowerCase())) continue;
```

Borra el tipo en línea que había en el `as` del `res.json()` anterior; ahora es `CuerpoMyMemory`.

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/diccionario/traductor.test.ts`
Esperado: PASA, todas. Comprueba que las pruebas **que ya existían** siguen pasando: la respuesta buena tiene `responseStatus` ausente en el objeto `respuestaOk` del fichero, y por eso `cuotaAgotada` devuelve `false` para ella. Si alguna vieja falla, el fallo está en tu implementación, no en la prueba.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add lib/diccionario/traductor.ts tests/diccionario/traductor.test.ts
git commit -m "No pintar el aviso de cuota de MyMemory como si fuera español"
```

---

### Task 6: MyMemory escribe a nivel de palabra

**Files:**
- Modify: `db/repository/espanol.ts`
- Modify: `db/repository/diccionario.ts` (borrar `traducirSiFalta`)
- Delete: `tests/db/diccionario-traduccion.test.ts`
- Test: `tests/db/espanol-busqueda.test.ts` (se amplía)

**Interfaces:**
- Consumes: `Traductor` de `@/lib/diccionario/traductor`.
- Produces: `export async function completarConTraductor(db: Database, termino: string, encontrados: SignificadosDePalabra[], traductor: Traductor): Promise<SignificadosDePalabra[]>`

**Esta es la tarea que arregla el caché.** El fallo no era una condición mal puesta: era que la respuesta de MyMemory es de **la palabra** y se estaba guardando en el sitio de **la acepción**. Ahora tiene su propio sitio, así que se guarda siempre y se pregunta una vez en la vida.

- [ ] **Step 1: Escribe la prueba que falla**

Añade un `describe` nuevo al final de `tests/db/espanol-busqueda.test.ts`:

```ts
describe("completarConTraductor", () => {
  it("no llama al traductor si ya hay significados", async () => {
    const { db, close } = await createTestDb();
    const encontrados = [
      { term: "dog", pos: "noun", meanings: ["Perro."], source: ORIGEN_WIKCIONARIO_ES },
    ];
    const traductor = vi.fn(async () => ["perro"]);

    const resultado = await completarConTraductor(db, "dog", encontrados, traductor);

    expect(traductor).not.toHaveBeenCalled();
    expect(resultado).toEqual(encontrados);
    await close();
  });

  it("traduce lo que falta y lo devuelve como grupo sin categoría", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar", "denegar"]);

    const resultado = await completarConTraductor(db, "turn down", [], traductor);

    expect(traductor).toHaveBeenCalledExactlyOnceWith("turn down");
    expect(resultado).toEqual([
      { term: "turn down", pos: "", meanings: ["rechazar", "denegar"], source: ORIGEN_MYMEMORY },
    ]);
    await close();
  });

  /**
   * El fallo que esto arregla. Antes solo se guardaba si a la palabra le
   * faltaba el español en **una única** acepción, cosa que casi nunca pasa: por
   * eso las 267.014 filas del diccionario tenían la fuente a nulo y cada
   * búsqueda volvía a gastar cuota. Ahora el dato tiene su nivel y se guarda
   * siempre.
   */
  it("guarda lo traducido: la segunda búsqueda ya no gasta cuota", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar"]);

    await completarConTraductor(db, "turn down", [], traductor);
    const segunda = await completarConTraductor(
      db,
      "turn down",
      await buscarSignificadosEspanoles(db, "turn down"),
      traductor,
    );

    expect(traductor).toHaveBeenCalledTimes(1);
    expect(segunda[0].meanings).toEqual(["rechazar"]);
    await close();
  });

  it("si el traductor no devuelve nada, no guarda nada y la palabra se queda sin español", async () => {
    const { db, close } = await createTestDb();

    const resultado = await completarConTraductor(db, "xyzzy", [], async () => []);

    expect(resultado).toEqual([]);
    expect(await db.select().from(spanishMeanings)).toHaveLength(0);
    await close();
  });

  /**
   * Guardar con la clave normalizada, no con lo que se escribió: si no, buscar
   * "Turn Down" crearía una fila distinta y la cuota se gastaría dos veces.
   */
  it("guarda con la clave normalizada", async () => {
    const { db, close } = await createTestDb();
    const traductor = vi.fn(async () => ["rechazar"]);

    await completarConTraductor(db, "  Turn   Down ", [], traductor);
    await completarConTraductor(
      db,
      "turn down",
      await buscarSignificadosEspanoles(db, "turn down"),
      traductor,
    );

    expect(traductor).toHaveBeenCalledTimes(1);
    await close();
  });
});
```

Añade a los imports del fichero: `vi` desde `vitest`, y `completarConTraductor` desde `@/db/repository/espanol`.

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/espanol-busqueda.test.ts`
Esperado: FALLA con `completarConTraductor is not a function`.

- [ ] **Step 3: Escríbelo**

En `db/repository/espanol.ts`, al final. Añade `normalizeTerm` de `@/lib/normalize` y `type Traductor` de `@/lib/diccionario/traductor` a los imports:

```ts
/**
 * Si la palabra no tiene español, se lo pide al traductor gratuito y **lo
 * guarda**.
 *
 * Aquí está el arreglo del caché roto. Antes esto vivía en `traducirSiFalta`,
 * que escribía sobre `dictionary_entries` —una fila por acepción— y por eso
 * solo se atrevía a guardar cuando había exactamente una acepción sin español:
 * escribir "banco" en las siete entradas de *bank* habría dejado la de orilla
 * mal traducida y marcada como buena para siempre. Con varias acepciones no
 * guardaba nada, que es casi siempre, y cada búsqueda volvía a gastar cuota.
 *
 * No era un descuido: era el dato en el sitio equivocado. MyMemory contesta
 * "qué significa esta palabra", y ahora eso tiene su propia fila. Se guarda
 * siempre, sin falsear nada, y se pregunta una vez en la vida.
 *
 * La categoría queda vacía a propósito: el traductor no dice de cuál habla.
 */
export async function completarConTraductor(
  db: Database,
  termino: string,
  encontrados: SignificadosDePalabra[],
  traductor: Traductor,
): Promise<SignificadosDePalabra[]> {
  if (encontrados.length > 0) return encontrados;

  const meanings = await traductor(termino.trim());
  if (meanings.length === 0) return [];

  const term = termino.trim();
  await db
    .insert(spanishMeanings)
    .values({
      termNormalized: normalizeTerm(term),
      term,
      pos: "",
      meanings,
      source: ORIGEN_MYMEMORY,
    })
    .onConflictDoUpdate({
      target: [spanishMeanings.termNormalized, spanishMeanings.pos],
      set: { meanings: sql`excluded.meanings`, source: sql`excluded.source` },
    });

  return [{ term, pos: "", meanings, source: ORIGEN_MYMEMORY }];
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/espanol-busqueda.test.ts`
Esperado: PASA, 12 pruebas.

- [ ] **Step 5: Retira `traducirSiFalta`**

Borra de `db/repository/diccionario.ts` la función `traducirSiFalta` entera con su comentario, y quita de los imports lo que quede sin usar (`type Traductor`; comprueba si `eq` sigue haciendo falta — sí, lo usa `buscarEnDiccionario`).

Borra el fichero de pruebas que la cubría:

```bash
git rm tests/db/diccionario-traduccion.test.ts
```

Sus casos ya no aplican: probaban justo el comportamiento de no-guardar que esta tarea sustituye. Lo que sí cubrían y no puede perderse —**que un traductor colgado no tumba la búsqueda**— vive en `tests/diccionario/traductor.test.ts`, que ya lo prueba con el `AbortSignal`.

`app/api/diccionario/route.ts` deja de compilar aquí, porque importa `traducirSiFalta`. Es esperado: lo arregla la tarea 7. **Para que el árbol quede sano, haz la tarea 7 antes de dar por buena esta.** Si prefieres commits que compilen siempre, junta las dos tareas en un solo commit al final de la 7.

- [ ] **Step 6: Commit**

```bash
npx vitest run tests/db/ tests/diccionario/
git add db/repository/espanol.ts db/repository/diccionario.ts tests/db/
git commit -m "Guardar el español de MyMemory a nivel de palabra, que es su nivel"
```

---

### Task 7: La ruta devuelve los significados

**Files:**
- Modify: `app/api/diccionario/route.ts`
- Test: `tests/api/diccionario.test.ts`

**Interfaces:**
- Consumes: `buscarSignificadosEspanoles`, `completarConTraductor` de `@/db/repository/espanol`; `agruparPorCategoria`, `nombreDeCategoria` de `@/lib/diccionario/categoria`; `MAXIMO_SIGNIFICADOS_MOSTRADOS` de `@/lib/diccionario/espanol`.
- Produces: la respuesta de `GET /api/diccionario` gana el campo `significados: Array<{ pos: string; nombre: string; meanings: string[]; source: string }>`, ordenado por la categoría gramatical.

- [ ] **Step 1: Escribe la prueba que falla**

`tests/api/diccionario.test.ts` **no usa PGlite**: simula el repositorio con
`vi.mock` y comprueba solo lo que hace la ruta. Sigue ese patrón.

Primero, arriba del fichero, cambia el simulacro del repositorio del diccionario
—`traducirSiFalta` ya no existe— y añade el del repositorio español:

```ts
const buscarEnDiccionario = vi.fn();
const buscarEnBiblioteca = vi.fn();
vi.mock("@/db/repository/diccionario", () => ({
  buscarEnDiccionario: (...args: unknown[]) => buscarEnDiccionario(...args),
  buscarEnBiblioteca: (...args: unknown[]) => buscarEnBiblioteca(...args),
}));

const buscarSignificadosEspanoles = vi.fn();
// Por defecto se comporta como el escalón que no hace falta: devuelve lo que ya
// se encontró. Cada prueba que quiera ejercitar el traductor lo redefine.
const completarConTraductor = vi.fn(
  async (_db: unknown, _termino: string, encontrados: unknown) => encontrados,
);
vi.mock("@/db/repository/espanol", () => ({
  buscarSignificadosEspanoles: (...args: unknown[]) => buscarSignificadosEspanoles(...args),
  completarConTraductor: (db: unknown, termino: string, encontrados: unknown, traductor: unknown) =>
    completarConTraductor(db, termino, encontrados, traductor),
}));
```

En el `beforeEach`, añade `buscarSignificadosEspanoles.mockReset()` y déjalo
devolviendo `[]` por defecto, porque **todas** las pruebas que ya existen pasan
por él:

```ts
beforeEach(() => {
  buscarEnDiccionario.mockReset();
  buscarEnBiblioteca.mockReset();
  buscarSignificadosEspanoles.mockReset();
  buscarSignificadosEspanoles.mockResolvedValue([]);
});
```

Y añade estas pruebas al `describe("GET /api/diccionario", ...)`:

```ts
  it("devuelve los significados en español, ordenados por categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    // A propósito en orden inverso al de la escala: el verbo va después del
    // sustantivo en pantalla, lo devuelva la base en el orden que lo devuelva.
    buscarSignificadosEspanoles.mockResolvedValue([
      { term: "dog", pos: "verb", meanings: ["Acosar."], source: "wikcionario-es" },
      { term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
    ]);

    const cuerpo = await (await pide("dog")).json();

    expect(cuerpo.significados.map((g: { pos: string }) => g.pos)).toEqual(["noun", "verb"]);
    expect(cuerpo.significados[0]).toMatchObject({
      nombre: "Sustantivo",
      meanings: ["Perro."],
      source: "wikcionario-es",
    });
  });

  it("enseña como mucho cinco significados por categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    buscarSignificadosEspanoles.mockResolvedValue([
      {
        term: "language",
        pos: "noun",
        meanings: ["Uno.", "Dos.", "Tres.", "Cuatro.", "Cinco.", "Seis.", "Siete."],
        source: "wikcionario-es",
      },
    ]);

    const cuerpo = await (await pide("language")).json();

    expect(cuerpo.significados[0].meanings).toHaveLength(5);
    expect(cuerpo.significados[0].meanings.at(-1)).toBe("Cinco.");
  });

  /**
   * El grupo de MyMemory llega sin categoría, y así se queda: inventarle una
   * sería decir que el traductor dijo algo que no dijo.
   */
  it("el grupo sin categoría sale sin nombre de categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    buscarSignificadosEspanoles.mockResolvedValue([
      { term: "turn down", pos: "", meanings: ["rechazar"], source: "mymemory" },
    ]);

    const cuerpo = await (await pide("turn down")).json();

    expect(cuerpo.significados[0].nombre).toBe("");
    expect(cuerpo.significados[0].source).toBe("mymemory");
  });

  /**
   * El escalón que cuesta cuota solo se pisa cuando los gratuitos no dieron
   * nada. Llamarlo teniendo ya el español sería gastar caracteres para tirarlos.
   */
  it("le pasa al traductor lo que ya se encontró, para que decida si hace falta", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    const encontrados = [
      { term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
    ];
    buscarSignificadosEspanoles.mockResolvedValue(encontrados);

    await pide("dog");

    expect(completarConTraductor).toHaveBeenCalled();
    expect(completarConTraductor.mock.calls.at(-1)?.[2]).toEqual(encontrados);
  });

  it("sin español en ningún origen, la lista viene vacía en vez de faltar", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);

    const cuerpo = await (await pide("xyzzy")).json();

    expect(cuerpo.significados).toEqual([]);
  });
```

Las pruebas de «cuando la base de datos falla» siguen valiendo tal cual: el
`Promise.all` de la ruta propaga igual el rechazo de cualquiera de las tres
consultas.

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/api/diccionario.test.ts`
Esperado: FALLA — hoy la ruta ni siquiera compila, porque la tarea 6 se llevó `traducirSiFalta`.

- [ ] **Step 3: Reescribe la ruta**

`app/api/diccionario/route.ts`, sustituyendo el cuerpo del `try`:

```ts
    const [enBiblioteca, acepciones, encontrados] = await Promise.all([
      buscarEnBiblioteca(db, termino),
      buscarEnDiccionario(db, termino),
      buscarSignificadosEspanoles(db, termino),
    ]);

    // El escalón de pago: solo si los tres gratuitos no dieron español.
    const conEspanol = await completarConTraductor(
      db,
      termino,
      encontrados,
      crearTraductorMyMemory(),
    );

    // Una fila por palabra y categoría, así que cada grupo trae exactamente
    // una; se usa `agruparPorCategoria` por su orden, que es el mismo con el
    // que se enseñan las acepciones justo debajo.
    const significados = agruparPorCategoria(conEspanol).map((grupo) => ({
      pos: grupo.pos,
      nombre: grupo.nombre,
      meanings: grupo.acepciones
        .flatMap((fila) => fila.meanings)
        .slice(0, MAXIMO_SIGNIFICADOS_MOSTRADOS),
      source: grupo.acepciones[0].source,
    }));

    const pistasGuardadas = new Set(enBiblioteca.map((t) => t.senseHint));
    return NextResponse.json({
      termino,
      enBiblioteca,
      significados,
      acepciones: acepciones.map((a) => ({ ...a, yaGuardada: pistasGuardadas.has(a.gloss) })),
    });
```

Actualiza los imports: fuera `traducirSiFalta`, dentro `buscarSignificadosEspanoles` y `completarConTraductor` de `@/db/repository/espanol`, `agruparPorCategoria` de `@/lib/diccionario/categoria` y `MAXIMO_SIGNIFICADOS_MOSTRADOS` de `@/lib/diccionario/espanol`.

Actualiza también el comentario de cabecera de la ruta: sigue siendo verdad que **no llama a Claude nunca**, pero ahora los escalones son cuatro.

- [ ] **Step 4: Ejecuta las pruebas para verlas pasar**

Ejecuta: `npx vitest run tests/api/diccionario.test.ts`
Esperado: PASA, todas, incluidas las que ya existían.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add app/api/diccionario/route.ts tests/api/diccionario.test.ts
git commit -m "Devolver los significados en español desde la búsqueda del diccionario"
```

---

### Task 8: La pantalla

**Files:**
- Modify: `components/BuscadorDiccionario.tsx`
- Test: `tests/buscador-diccionario.test.ts`

**Interfaces:**
- Consumes: el campo `significados` de la respuesta.
- Produces, todas exportadas y puras:
  - `export function etiquetaDeOrigen(source: string): string`
  - `export function significadosDeLaAcepcion(significados: GrupoDeSignificados[], pos: string): string[]`
  - `export function traduccionParaGuardar(manual: string, deLaAcepcion: string[], deLaPalabra: string[]): string`
  - `export function botonAnadirDeshabilitado(nivel: string, traduccion: string, enCurso: boolean): boolean` — **cambia de firma**
  - `anadirAcepcion(acepcion, nivel, traduccion, fetchImpl?)` — **gana un parámetro**
  - Desaparece `acepcionConTraduccion`, que `traduccionParaGuardar` sustituye.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `tests/buscador-diccionario.test.ts`:

```ts
describe("etiquetaDeOrigen", () => {
  /**
   * Uno es un diccionario escrito por personas y el otro una máquina.
   * Enseñarlos igual sería mentir sobre lo que se está leyendo.
   */
  it("distingue el diccionario de la traducción automática", () => {
    expect(etiquetaDeOrigen("wikcionario-es")).toBe("Wikcionario español");
    expect(etiquetaDeOrigen("mymemory")).toBe("traducción automática");
  });

  it("un origen desconocido sale tal cual en vez de en blanco", () => {
    expect(etiquetaDeOrigen("otro")).toBe("otro");
  });
});

describe("significadosDeLaAcepcion", () => {
  const significados = [
    { pos: "noun", nombre: "Sustantivo", meanings: ["Perro."], source: "wikcionario-es" },
    { pos: "verb", nombre: "Verbo", meanings: ["Acosar."], source: "wikcionario-es" },
  ];

  it("da los de su categoría", () => {
    expect(significadosDeLaAcepcion(significados, "verb")).toEqual(["Acosar."]);
  });

  /**
   * MyMemory no dice de qué categoría habla, así que su grupo vale para
   * cualquier acepción: es el único español que hay.
   */
  it("si no hay de su categoría, cae en el grupo sin categoría", () => {
    const soloMyMemory = [{ pos: "", nombre: "", meanings: ["rechazar"], source: "mymemory" }];
    expect(significadosDeLaAcepcion(soloMyMemory, "verb")).toEqual(["rechazar"]);
  });

  it("sin nada que valga, devuelve vacío", () => {
    expect(significadosDeLaAcepcion(significados, "adj")).toEqual([]);
    expect(significadosDeLaAcepcion([], "noun")).toEqual([]);
  });
});

describe("traduccionParaGuardar", () => {
  it("lo escrito a mano manda sobre todo", () => {
    expect(traduccionParaGuardar("  mi versión ", ["de la acepción"], ["de la palabra"])).toBe("mi versión");
  });

  /**
   * El de la acepción es más preciso que el de la palabra: viene del volcado
   * inglés o de afinar con IA, que responden por esa acepción concreta.
   */
  it("sin nada escrito, manda el de la acepción sobre el de la palabra", () => {
    expect(traduccionParaGuardar("", ["orilla"], ["banco", "reserva"])).toBe("orilla");
  });

  it("y si la acepción no tiene, sirve el de la palabra", () => {
    expect(traduccionParaGuardar("", [], ["banco", "reserva"])).toBe("banco, reserva");
  });

  it("sin ninguno de los tres, cadena vacía", () => {
    expect(traduccionParaGuardar("   ", [], [])).toBe("");
  });
});

describe("botonAnadirDeshabilitado", () => {
  it("hace falta nivel y alguna traducción", () => {
    expect(botonAnadirDeshabilitado("", "perro", false)).toBe(true);
    expect(botonAnadirDeshabilitado("B2", "", false)).toBe(true);
    expect(botonAnadirDeshabilitado("B2", "   ", false)).toBe(true);
    expect(botonAnadirDeshabilitado("B2", "perro", false)).toBe(false);
  });

  /**
   * Con la petición en vuelo se deshabilita: dos clics mandarían dos POST antes
   * de que la pantalla oculte el botón.
   */
  it("con la petición en vuelo, deshabilitado", () => {
    expect(botonAnadirDeshabilitado("B2", "perro", true)).toBe(true);
  });
});

describe("anadirAcepcion", () => {
  it("manda la traducción que se le pasa, no la de la acepción", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const acepcion = {
      id: 1, term: "bank", pos: "noun", gloss: "An edge of a river.",
      example: null, translations: [], yaGuardada: false,
    };

    await anadirAcepcion(acepcion, "B2", "orilla", fetchFalso as unknown as typeof fetch);

    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(cuerpo.translation).toBe("orilla");
    expect(cuerpo.gloss).toBe("An edge of a river.");
  });
});
```

Borra del fichero las pruebas de `acepcionConTraduccion` y las de la firma vieja de `botonAnadirDeshabilitado`, y actualiza los imports.

- [ ] **Step 2: Ejecuta las pruebas para verlas fallar**

Ejecuta: `npx vitest run tests/buscador-diccionario.test.ts`
Esperado: FALLA con errores de importación y de firma.

- [ ] **Step 3: Escribe las funciones puras**

En `components/BuscadorDiccionario.tsx`, junto a las demás funciones exportadas:

```ts
export type GrupoDeSignificados = {
  pos: string;
  nombre: string;
  meanings: string[];
  source: string;
};
```

y añade `significados: GrupoDeSignificados[]` al tipo `Resultado`.

```ts
/**
 * Cómo se llama en pantalla cada origen del español. No es decorado: uno es un
 * diccionario escrito por personas y el otro una máquina, y el usuario tiene
 * que poder distinguirlos antes de guardarse una palabra.
 */
export function etiquetaDeOrigen(source: string): string {
  if (source === "wikcionario-es") return "Wikcionario español";
  if (source === "mymemory") return "traducción automática";
  // Un origen que no conozcamos se enseña tal cual: mejor eso que un hueco.
  return source;
}

/**
 * El español de la palabra que le toca a una acepción: el de su categoría y, si
 * no hay, el del grupo sin categoría —el de MyMemory, que no dice de cuál
 * habla y por eso vale para cualquiera—.
 */
export function significadosDeLaAcepcion(
  significados: GrupoDeSignificados[],
  pos: string,
): string[] {
  const suyo = significados.find((g) => g.pos === pos);
  if (suyo) return suyo.meanings;
  return significados.find((g) => g.pos === "")?.meanings ?? [];
}

/**
 * Qué español se guarda en la tarjeta, por orden de precisión: lo escrito a
 * mano, lo de la acepción, lo de la palabra.
 *
 * Los dos primeros escalones son los de siempre. El tercero es nuevo y solo
 * añade salidas donde antes no había ninguna: sin él, una palabra cuyo español
 * solo esté a nivel de palabra no se podría añadir sin escribirlo a mano o
 * pagar por afinar.
 */
export function traduccionParaGuardar(
  manual: string,
  deLaAcepcion: string[],
  deLaPalabra: string[],
): string {
  return manual.trim() || deLaAcepcion.join(", ") || deLaPalabra.join(", ") || "";
}
```

Sustituye `botonAnadirDeshabilitado` por:

```ts
/**
 * Si el botón "Añadir" debe estar deshabilitado: sin nivel, sin nada de español
 * que guardar, o con la petición de esta tarjeta ya en vuelo —esto último evita
 * el doble clic que mandaría dos `POST /api/terms`—. Pura para poder probarla:
 * el resto del estado del componente es React y no se puede probar sin jsdom.
 */
export function botonAnadirDeshabilitado(
  nivel: string,
  traduccion: string,
  enCurso: boolean,
): boolean {
  return !nivel || !traduccion.trim() || enCurso;
}
```

Borra `acepcionConTraduccion` y cambia `anadirAcepcion` para que reciba la traducción ya resuelta:

```ts
export async function anadirAcepcion(
  acepcion: Acepcion,
  nivel: string,
  traduccion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!nivel) throw new Error("Elige un nivel antes de añadir.");
```

y en el cuerpo de la petición, `translation: traduccion` en vez de `acepcion.translations.join(", ")`.

- [ ] **Step 4: Ejecuta las pruebas para verlas pasar**

Ejecuta: `npx vitest run tests/buscador-diccionario.test.ts`
Esperado: PASA, todas.

- [ ] **Step 5: Pinta el bloque de significados y pliega el inglés**

En el JSX, **antes** del bloque que pinta `agruparPorCategoria(resultado.acepciones)`:

```tsx
      {resultado && resultado.significados.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
            Significados en español
          </h2>
          {resultado.significados.map((grupo) => (
            <Tarjeta key={grupo.pos}>
              <div className="flex flex-col gap-2">
                {/* El grupo de MyMemory no lleva encabezado: no se sabe de qué
                    categoría habla, e inventarle una sería mentir. */}
                {grupo.nombre && (
                  <p style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
                    {grupo.nombre}
                  </p>
                )}
                <ol className="flex list-inside list-decimal flex-col gap-1">
                  {grupo.meanings.map((significado) => (
                    <li key={significado}>{significado}</li>
                  ))}
                </ol>
                <p style={{ fontSize: "var(--tamano-1)" }} className="text-texto-suave">
                  {etiquetaDeOrigen(grupo.source)}
                </p>
              </div>
            </Tarjeta>
          ))}
        </section>
      )}
```

Dentro de la ficha de cada acepción, sustituye las dos líneas que pintan `gloss` y `example` por un desplegable:

```tsx
                  {/* El inglés plegado: el usuario pidió no leerlo, pero sigue
                      siendo lo que distingue una acepción de otra, así que se
                      guarda como `senseHint` y se puede abrir cuando hace falta. */}
                  <details>
                    <summary
                      style={{ fontSize: "var(--tamano-1)" }}
                      className="cursor-pointer text-texto-suave"
                    >
                      Significado en inglés
                    </summary>
                    <p className="mt-2">{acepcion.gloss}</p>
                    {acepcion.example && (
                      <p className="mt-1 italic text-texto-suave">{acepcion.example}</p>
                    )}
                  </details>
```

Y deja el español propio de la acepción **visible**, no plegado, sustituyendo el bloque de `translations` por:

```tsx
                  {acepcion.translations.length > 0 && (
                    <p>→ {acepcion.translations.join(", ")}</p>
                  )}
```

(El caso «sin traducción al español» ya no se avisa aquí: lo dice el bloque de arriba, y repetirlo en cada ficha sería ruido.)

- [ ] **Step 6: Conecta la precedencia en los dos sitios que la usan**

Dentro del `map` de las acepciones, calcula una vez:

```tsx
              const deLaPalabra = significadosDeLaAcepcion(resultado.significados, acepcion.pos);
              const traduccion = traduccionParaGuardar(
                traduccionesManuales[acepcion.id] ?? "",
                acepcion.translations,
                deLaPalabra,
              );
```

Úsalo en el botón:

```tsx
                          disabled={botonAnadirDeshabilitado(
                            niveles[acepcion.id] ?? "",
                            traduccion,
                            guardandoIds.has(acepcion.id),
                          )}
```

Y en `anadir`, que ahora necesita la traducción resuelta. Cambia su firma a `anadir(acepcion: Acepcion, traduccion: string)` y dentro:

```tsx
      await anadirAcepcion(acepcion, niveles[acepcion.id] ?? "", traduccion);
```

El `onClick` pasa a `onClick={() => anadir(acepcion, traduccion)}`.

Si el `map` usa cuerpo de expresión (`=> (`), cámbialo a cuerpo de bloque con `return`.

- [ ] **Step 7: Comprueba en el navegador**

Arranca el servidor con la herramienta de vista previa (**nunca con `npm run dev` por Bash**) y entra en `/diccionario`. Busca:

- `dog` — debe salir el bloque de significados con «Sustantivo» y «Verbo», y debajo «Wikcionario español».
- `turn down` — no está en el volcado español, así que debe salir el grupo sin encabezado de categoría y con «traducción automática».
- Cualquiera — el desplegable «Significado en inglés» abre y cierra, y el botón «Añadir» se habilita al elegir nivel.

Si tu base local no tiene el diccionario español cargado, carga primero unas pocas líneas con el script de la tarea 3 sobre un fichero de prueba; **no cargues nada en la base de producción**.

- [ ] **Step 8: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add components/BuscadorDiccionario.tsx tests/buscador-diccionario.test.ts
git commit -m "Enseñar el español primero y plegar el inglés"
```

---

## Al terminar

1. **Ejecuta la suite entera**: `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
2. **Repasa la especificación** de arriba abajo y comprueba que cada sección tiene su código.
3. **No apliques la migración a producción ni cargues el diccionario en la base real.** Eso lo hace el usuario, y la migración va **a mano, ejecutando el `.sql`**, no con `drizzle-kit push`: push no ejecuta el fichero, compara `db/schema.ts` con la base y pregunta, y contestar mal a esa pregunta ya costó un susto en la migración 0005. Deja escrito en el informe final los dos comandos exactos que tiene que ejecutar.
