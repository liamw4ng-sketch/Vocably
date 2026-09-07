# Diccionario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir una pantalla `/diccionario` donde se busca un término en inglés y se añade a la biblioteca con su nivel, sin pasar por un PDF ni por la API de Claude.

**Architecture:** El diccionario es una tabla de Postgres cargada una sola vez desde un fichero ya descargado y filtrado (181.103 entradas, 36 MB). La búsqueda recorre cuatro escalones —biblioteca, tabla del diccionario, traductor gratuito cacheado, y Claude solo si el usuario pulsa un botón— y para en el primero que responde. Añadir un término reutiliza las tablas que ya existen (`terms`, `term_occurrences`, `card_states`), con una columna nueva que permite guardar dos acepciones de la misma palabra.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19, TypeScript, Drizzle ORM sobre Neon (Postgres), Vitest con PGlite (Postgres en memoria), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-07-diccionario-design.md`

## Global Constraints

- **Las migraciones se generan como ficheros**, con `npx drizzle-kit generate`, nunca solo con `push`. `tests/helpers/test-db.ts` aplica `migrate(db, { migrationsFolder: "./drizzle" })`: una migración que solo exista en la base real deja todas las pruebas corriendo contra un esquema viejo.
- **Ninguna prueba toca la red.** El traductor y el cliente de Anthropic se inyectan.
- **Ninguna prueba toca una base de datos real.** Siempre `createTestDb()` de `tests/helpers/test-db.ts`.
- **Los datos del diccionario están en `/Users/yijun/Vocably-diccionario/dicc_todo.jsonl.gz`**, fuera del repositorio. No se vuelven a descargar: bajarlos cuesta 3,2 GB y 45 minutos.
- **El código nuevo de dominio se nombra en español**, como el que ya hay (`barajar`, `inicioDelDia`, `getAjustes`). Los comentarios explican *por qué*, no *qué*.
- **La interfaz se monta con `components/ui/`** (`Boton`, `Campo`, `Tarjeta`) y los tokens de `globals.css`. Sin animaciones ni capas decorativas: el usuario pidió mantener las pantallas simples.
- **Nivel del MCER:** `A1 A2 B1 B2 C1 C2`. Sin valor por defecto al añadir desde el diccionario.
- **Tipos de término:** `word` | `phrasal_verb` | `expression`.
- Comprobación completa antes de cada commit: `npm test`, `npx tsc --noEmit`, `npx eslint .`

---

### Task 1: Convertir una línea del volcado en filas de diccionario

El fichero descargado tiene una línea JSON por entrada, con esta forma:

```json
{"w": "come across", "p": "verb", "s": [{"g": "To find, usually by accident.", "e": "In the dark he came across an old box.", "es": ["encontrar"]}]}
```

Una entrada trae varias acepciones; en la base de datos cada acepción es una fila. Y **2.749 entradas traen glosas basura** del tipo `"Used other than figuratively or idiomatically: see come, across."`, que salen como primera acepción de varios verbos frasales y no le sirven de nada al usuario.

**Files:**
- Create: `lib/diccionario/entrada.ts`
- Test: `tests/diccionario/entrada.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` de `@/lib/normalize`
- Produces:
  ```ts
  export type FilaDiccionario = {
    termNormalized: string;
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translations: string[];
  };
  export function filasDeLinea(linea: string): FilaDiccionario[];
  export function esGlosaInutil(gloss: string): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/diccionario/entrada.test.ts
import { describe, it, expect } from "vitest";
import { filasDeLinea, esGlosaInutil } from "@/lib/diccionario/entrada";

const comeAcross = JSON.stringify({
  w: "Come Across",
  p: "verb",
  s: [
    { g: "Used other than figuratively or idiomatically: see come, across.", e: "He came across the street." },
    { g: "To find, usually by accident.", e: "He came across an old box.", es: ["encontrar", "toparse con"] },
    { g: "To give an appearance or impression." },
  ],
});

describe("filasDeLinea", () => {
  it("crea una fila por acepción, con la clave normalizada", () => {
    const filas = filasDeLinea(comeAcross);
    expect(filas).toHaveLength(2);
    expect(filas[0].termNormalized).toBe("come across");
    expect(filas[0].term).toBe("Come Across");
    expect(filas[0].pos).toBe("verb");
  });

  it("descarta la glosa que remite a las palabras sueltas", () => {
    const glosas = filasDeLinea(comeAcross).map((f) => f.gloss);
    expect(glosas).not.toContain(
      "Used other than figuratively or idiomatically: see come, across.",
    );
    expect(glosas[0]).toBe("To find, usually by accident.");
  });

  it("conserva ejemplo y traducciones, y admite que falten", () => {
    const [primera, segunda] = filasDeLinea(comeAcross);
    expect(primera.example).toBe("He came across an old box.");
    expect(primera.translations).toEqual(["encontrar", "toparse con"]);
    expect(segunda.example).toBeNull();
    expect(segunda.translations).toEqual([]);
  });

  it("devuelve vacío si todas las acepciones son basura", () => {
    const soloBasura = JSON.stringify({
      w: "look at",
      p: "verb",
      s: [{ g: "Used other than figuratively or idiomatically: see look, at." }],
    });
    expect(filasDeLinea(soloBasura)).toEqual([]);
  });

  it("devuelve vacío ante una línea ilegible, sin reventar la carga", () => {
    expect(filasDeLinea("{esto no es json")).toEqual([]);
    expect(filasDeLinea("")).toEqual([]);
  });
});

describe("esGlosaInutil", () => {
  it("reconoce las remisiones y las formas alternativas", () => {
    expect(esGlosaInutil("Used other than figuratively or idiomatically: see x, y.")).toBe(true);
    expect(esGlosaInutil("Alternative form of colour.")).toBe(true);
    expect(esGlosaInutil("Synonym of bite off more than one can chew.")).toBe(false);
    expect(esGlosaInutil("To find, usually by accident.")).toBe(true === false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diccionario/entrada.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/diccionario/entrada"`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/diccionario/entrada.ts
import { normalizeTerm } from "@/lib/normalize";

export type FilaDiccionario = {
  termNormalized: string;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
};

/**
 * Glosas que Wikcionario incluye por completitud y que al usuario no le dicen
 * nada: remiten a otra entrada en vez de explicar el término. Son 2.749 en el
 * volcado, y salen como *primera* acepción de varios verbos frasales, así que
 * sin este filtro lo primero que se lee de "come across" es "see come, across".
 */
export function esGlosaInutil(gloss: string): boolean {
  const g = gloss.trim().toLowerCase();
  return (
    g.startsWith("used other than figuratively") ||
    g.startsWith("alternative form of") ||
    g.startsWith("alternative spelling of") ||
    g.startsWith("obsolete form of") ||
    g.startsWith("misspelling of")
  );
}

type LineaCruda = {
  w?: unknown;
  p?: unknown;
  s?: unknown;
};

/** Una entrada del volcado se convierte en una fila por acepción. */
export function filasDeLinea(linea: string): FilaDiccionario[] {
  let cruda: LineaCruda;
  try {
    cruda = JSON.parse(linea) as LineaCruda;
  } catch {
    // Una línea ilegible no puede abortar una carga de 181.103: se salta.
    return [];
  }

  const term = typeof cruda.w === "string" ? cruda.w.trim() : "";
  const pos = typeof cruda.p === "string" ? cruda.p : "";
  if (!term || !pos || !Array.isArray(cruda.s)) return [];

  const filas: FilaDiccionario[] = [];
  for (const acepcion of cruda.s) {
    if (typeof acepcion !== "object" || acepcion === null) continue;
    const { g, e, es } = acepcion as { g?: unknown; e?: unknown; es?: unknown };
    if (typeof g !== "string" || !g.trim() || esGlosaInutil(g)) continue;
    filas.push({
      termNormalized: normalizeTerm(term),
      term,
      pos,
      gloss: g.trim(),
      example: typeof e === "string" && e.trim() ? e.trim() : null,
      translations: Array.isArray(es) ? es.filter((t): t is string => typeof t === "string") : [],
    });
  }
  return filas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diccionario/entrada.test.ts`
Expected: PASS, 6 pruebas

- [ ] **Step 5: Commit**

```bash
git add lib/diccionario/entrada.ts tests/diccionario/entrada.test.ts
git commit -m "Convertir una línea del volcado de Wikcionario en filas de diccionario"
```

---

### Task 2: La tabla del diccionario

**Files:**
- Modify: `db/schema.ts` (al final del fichero)
- Create: `drizzle/0003_*.sql` y `drizzle/meta/0003_snapshot.json` (los genera drizzle-kit)
- Test: `tests/db/diccionario-schema.test.ts`

**Interfaces:**
- Produces: la tabla `dictionaryEntries`, importable desde `@/db/schema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/diccionario-schema.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { dictionaryEntries } from "@/db/schema";

describe("dictionary_entries", () => {
  it("guarda una acepción con su ejemplo y sus traducciones", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "come across",
      term: "come across",
      pos: "verb",
      gloss: "To find, usually by accident.",
      example: "He came across an old box.",
      translations: ["encontrar", "toparse con"],
    });

    const filas = await db.select().from(dictionaryEntries);
    expect(filas).toHaveLength(1);
    expect(filas[0].translations).toEqual(["encontrar", "toparse con"]);
    expect(filas[0].translationSource).toBeNull();
    await close();
  });

  it("admite dos acepciones del mismo término: no hay índice único", async () => {
    const { db, close } = await createTestDb();
    const base = { termNormalized: "bank", term: "bank", pos: "noun", translations: [] };
    await db.insert(dictionaryEntries).values({ ...base, gloss: "A financial institution." });
    await db.insert(dictionaryEntries).values({ ...base, gloss: "An edge of a river." });

    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("admite una acepción sin ejemplo ni traducciones", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "thorough",
      term: "thorough",
      pos: "adj",
      gloss: "Painstakingly careful.",
    });
    const [fila] = await db.select().from(dictionaryEntries);
    expect(fila.example).toBeNull();
    expect(fila.translations).toEqual([]);
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/diccionario-schema.test.ts`
Expected: FAIL — `dictionaryEntries` no existe en `@/db/schema`

- [ ] **Step 3: Write minimal implementation**

Añadir al final de `db/schema.ts` (y añadir `index` a los imports de `drizzle-orm/pg-core`):

```ts
/**
 * El diccionario de consulta: una fila por acepción. Se carga una vez desde el
 * volcado de Wikcionario y no se vuelve a escribir, salvo la traducción, que se
 * cachea la primera vez que alguien busca el término.
 *
 * No lleva índice único: la gracia es justo que un término tenga varias
 * acepciones (`bank` tiene siete entradas en Wikcionario, una por etimología).
 */
export const dictionaryEntries = pgTable(
  "dictionary_entries",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    pos: text("pos").notNull(),
    /** El significado, en inglés: es donde Wikcionario es fuerte. */
    gloss: text("gloss").notNull(),
    example: text("example"),
    translations: text("translations").array().notNull().default([]),
    /** `wiktionary` | `mymemory` | `claude`. Nulo mientras no haya traducción. */
    translationSource: text("translation_source"),
  },
  (table) => ({
    termNormalizedIdx: index("dictionary_entries_term_normalized_idx").on(table.termNormalized),
  }),
);
```

- [ ] **Step 4: Generate the migration file**

Run: `npx drizzle-kit generate`
Expected: crea `drizzle/0003_*.sql` con un solo `CREATE TABLE "dictionary_entries"` y su `CREATE INDEX`. **Léelo antes de seguir:** no debe tocar ninguna otra tabla.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/diccionario-schema.test.ts`
Expected: PASS, 3 pruebas

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle/ tests/db/diccionario-schema.test.ts
git commit -m "Añadir la tabla del diccionario de consulta"
```

---

### Task 3: Cargar el diccionario en la base de datos

181.103 filas no entran en un solo `INSERT`. La carga va por lotes y es **idempotente**: vaciar y recargar, porque el diccionario es material de consulta, no datos del usuario.

**Files:**
- Create: `db/repository/diccionario.ts`
- Create: `scripts/cargar-diccionario.ts`
- Modify: `package.json` (script `cargar:diccionario` y `tsx` como dependencia de desarrollo)
- Test: `tests/db/diccionario-carga.test.ts`

**Interfaces:**
- Consumes: `filasDeLinea`, `FilaDiccionario` de `@/lib/diccionario/entrada`
- Produces:
  ```ts
  export async function cargarDiccionario(
    db: Database,
    lineas: AsyncIterable<string>,
    opciones?: { tamanoLote?: number },
  ): Promise<{ entradas: number; filas: number }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/diccionario-carga.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarDiccionario } from "@/db/repository/diccionario";
import { dictionaryEntries } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

const bank = JSON.stringify({
  w: "bank",
  p: "noun",
  s: [{ g: "A financial institution." }, { g: "An edge of a river." }],
});
const basura = JSON.stringify({
  w: "look at",
  p: "verb",
  s: [{ g: "Used other than figuratively or idiomatically: see look, at." }],
});

describe("cargarDiccionario", () => {
  it("guarda una fila por acepción y cuenta lo cargado", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarDiccionario(db, lineasDe(bank));

    expect(resultado).toEqual({ entradas: 1, filas: 2 });
    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("salta las entradas sin ninguna acepción útil", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarDiccionario(db, lineasDe(bank, basura, ""));

    expect(resultado.entradas).toBe(1);
    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("vacía antes de cargar: recargar no duplica", async () => {
    const { db, close } = await createTestDb();
    await cargarDiccionario(db, lineasDe(bank));
    await cargarDiccionario(db, lineasDe(bank));

    expect(await db.select().from(dictionaryEntries)).toHaveLength(2);
    await close();
  });

  it("respeta el tamaño de lote sin perder filas", async () => {
    const { db, close } = await createTestDb();
    await cargarDiccionario(db, lineasDe(bank, bank, bank), { tamanoLote: 2 });

    expect(await db.select().from(dictionaryEntries)).toHaveLength(6);
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/diccionario-carga.test.ts`
Expected: FAIL — `cargarDiccionario` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
// db/repository/diccionario.ts
import { dictionaryEntries } from "@/db/schema";
import type { Database } from "@/db/types";
import { filasDeLinea, type FilaDiccionario } from "@/lib/diccionario/entrada";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/**
 * Vacía la tabla y la vuelve a llenar. Es a propósito: el diccionario es
 * material de consulta, no datos del usuario, así que recargarlo entero es más
 * simple y más seguro que intentar fusionar 181.103 filas.
 */
export async function cargarDiccionario(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number; filas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;
  await db.delete(dictionaryEntries);

  let entradas = 0;
  let filas = 0;
  let lote: FilaDiccionario[] = [];

  const vaciarLote = async () => {
    if (lote.length === 0) return;
    await db.insert(dictionaryEntries).values(lote);
    filas += lote.length;
    lote = [];
  };

  for await (const linea of lineas) {
    const nuevas = filasDeLinea(linea);
    if (nuevas.length === 0) continue;
    entradas += 1;
    lote.push(...nuevas);
    if (lote.length >= tamanoLote) await vaciarLote();
  }
  await vaciarLote();

  return { entradas, filas };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/diccionario-carga.test.ts`
Expected: PASS, 4 pruebas

- [ ] **Step 5: Write the script that reads the real file**

```ts
// scripts/cargar-diccionario.ts
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { cargarDiccionario } from "@/db/repository/diccionario";
import { getDb } from "@/db/client";

/**
 * Carga el diccionario en la base de datos apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-diccionario.ts ~/Vocably-diccionario/dicc_todo.jsonl.gz
 *
 * Se ejecuta a mano, una vez. No forma parte del arranque de la aplicación ni
 * del despliegue: el diccionario no cambia.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del fichero .jsonl.gz del diccionario.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const lineas = createInterface({
    input: createReadStream(ruta).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const inicio = Date.now();
  const { entradas, filas } = await cargarDiccionario(getDb(), lineas);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas (${filas} acepciones) en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Añadir a `package.json`:

```json
"scripts": {
  "cargar:diccionario": "tsx scripts/cargar-diccionario.ts"
}
```

y `"tsx": "^4.20.6"` en `devDependencies` — hoy solo está de forma transitiva, y depender de eso se rompe en cualquier `npm install`. Después: `npm install`.

- [ ] **Step 6: Run the real load**

```bash
DATABASE_URL='...' npm run cargar:diccionario -- ~/Vocably-diccionario/dicc_todo.jsonl.gz
```

Expected: `Cargadas 181103 entradas (~N acepciones)`. Comprobar después en la base:
`SELECT count(*) FROM dictionary_entries;` y `SELECT count(*) FROM dictionary_entries WHERE gloss ILIKE 'Used other than figuratively%';` → **0**.

- [ ] **Step 7: Commit**

```bash
git add db/repository/diccionario.ts scripts/cargar-diccionario.ts package.json package-lock.json tests/db/diccionario-carga.test.ts
git commit -m "Cargar el diccionario de Wikcionario en la base de datos"
```

---

### Task 4: Las variantes del lema

Wikcionario lemmatiza los idioms con *one*, no con *you*. La ficha de *bite off more than you can chew* está guardada como **`bite off more than one can chew`**: buscar la forma natural no encuentra nada. Es un fallo comprobado sobre los datos reales, no una precaución teórica.

**Files:**
- Create: `lib/diccionario/lema.ts`
- Test: `tests/diccionario/lema.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` de `@/lib/normalize`
- Produces: `export function variantesDelLema(termino: string): string[];` — claves normalizadas, sin repetir, **con la forma escrita siempre la primera**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/diccionario/lema.test.ts
import { describe, it, expect } from "vitest";
import { variantesDelLema } from "@/lib/diccionario/lema";

describe("variantesDelLema", () => {
  it("busca primero lo que se escribió", () => {
    expect(variantesDelLema("Come Across")[0]).toBe("come across");
  });

  it("encuentra el idiom que Wikcionario guarda con 'one'", () => {
    expect(variantesDelLema("bite off more than you can chew")).toContain(
      "bite off more than one can chew",
    );
  });

  it("funciona también al revés: de 'one' a 'you'", () => {
    expect(variantesDelLema("bite off more than one can chew")).toContain(
      "bite off more than you can chew",
    );
  });

  it("cambia los posesivos y los reflexivos", () => {
    expect(variantesDelLema("hold your horses")).toContain("hold one's horses");
    expect(variantesDelLema("make oneself at home")).toContain("make yourself at home");
  });

  it("intercambia someone y somebody", () => {
    expect(variantesDelLema("give someone a hand")).toContain("give somebody a hand");
  });

  it("solo cambia palabras enteras", () => {
    // "young" contiene "you" pero no es "you".
    expect(variantesDelLema("young at heart")).toEqual(["young at heart"]);
  });

  it("no repite la forma escrita cuando no hay nada que cambiar", () => {
    expect(variantesDelLema("thorough")).toEqual(["thorough"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diccionario/lema.test.ts`
Expected: FAIL — `@/lib/diccionario/lema` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/diccionario/lema.ts
import { normalizeTerm } from "@/lib/normalize";

/**
 * Wikcionario lemmatiza los idioms en tercera persona impersonal ("one"), y la
 * gente los escribe en segunda ("you"). Sin esto, buscar
 * "bite off more than you can chew" no encuentra nada: la ficha existe, pero
 * guardada como "...more than one can chew".
 */
const PARES: ReadonlyArray<readonly [string, string]> = [
  ["you", "one"],
  ["your", "one's"],
  ["yourself", "oneself"],
  ["yourselves", "oneself"],
  ["someone", "somebody"],
];

function sustituir(termino: string, de: string, a: string): string {
  // \b no sirve con apóstrofo ("one's"), así que el límite se hace a mano:
  // principio/fin de cadena o un carácter que no sea de palabra ni apóstrofo.
  const patron = new RegExp(`(^|[^\\w'])${de.replace("'", "'")}(?=$|[^\\w'])`, "g");
  return termino.replace(patron, (_coincidencia, prefijo: string) => `${prefijo}${a}`);
}

export function variantesDelLema(termino: string): string[] {
  const base = normalizeTerm(termino);

  // Dos pasadas completas, no todas las combinaciones: un idiom mezcla las dos
  // familias muy raramente, y generar el producto cartesiano multiplicaría las
  // consultas sin encontrar nada más.
  let haciaOne = base;
  let haciaYou = base;
  for (const [you, one] of PARES) {
    haciaOne = sustituir(haciaOne, you, one);
    haciaYou = sustituir(haciaYou, one, you);
  }

  const vistas = new Set<string>();
  return [base, haciaOne, haciaYou].filter((v) => {
    if (vistas.has(v)) return false;
    vistas.add(v);
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diccionario/lema.test.ts`
Expected: PASS, 7 pruebas

- [ ] **Step 5: Commit**

```bash
git add lib/diccionario/lema.ts tests/diccionario/lema.test.ts
git commit -m "Buscar también las variantes del lema: one/you, one's/your, someone/somebody"
```

---

### Task 5: Buscar en el diccionario y en la biblioteca

**Files:**
- Modify: `db/repository/diccionario.ts`
- Test: `tests/db/diccionario-busqueda.test.ts`

**Interfaces:**
- Consumes: `variantesDelLema` de `@/lib/diccionario/lema`; `normalizeTerm` de `@/lib/normalize`
- Produces:
  ```ts
  export type AcepcionDiccionario = {
    id: number;
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translations: string[];
  };
  export type TerminoGuardado = {
    id: number;
    term: string;
    translation: string;
    level: string;
    senseHint: string;
  };
  export async function buscarEnDiccionario(db: Database, termino: string): Promise<AcepcionDiccionario[]>;
  export async function buscarEnBiblioteca(db: Database, termino: string): Promise<TerminoGuardado[]>;
  ```

> **Nota para quien implemente:** `senseHint` es la columna que añade la Task 6. Esta tarea se escribe **después** de la 6 si se ejecutan en orden; si por lo que sea llegas aquí antes, haz la 6 primero.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/diccionario-busqueda.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarEnDiccionario, buscarEnBiblioteca } from "@/db/repository/diccionario";
import { saveExtraction } from "@/db/repository/extraction";
import { dictionaryEntries } from "@/db/schema";

async function sembrar(db: Parameters<typeof buscarEnDiccionario>[0]) {
  await db.insert(dictionaryEntries).values([
    { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", translations: [] },
    { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", translations: [] },
    {
      termNormalized: "bite off more than one can chew",
      term: "bite off more than one can chew",
      pos: "verb",
      gloss: "To try to do too much.",
      translations: [],
    },
  ]);
}

describe("buscarEnDiccionario", () => {
  it("devuelve todas las acepciones del término", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    const filas = await buscarEnDiccionario(db, "Bank");
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.gloss)).toContain("An edge of a river.");
    await close();
  });

  it("encuentra el idiom escrito con 'you' aunque esté guardado con 'one'", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    const filas = await buscarEnDiccionario(db, "bite off more than you can chew");
    expect(filas).toHaveLength(1);
    expect(filas[0].term).toBe("bite off more than one can chew");
    await close();
  });

  it("devuelve vacío si no está", async () => {
    const { db, close } = await createTestDb();
    await sembrar(db);
    expect(await buscarEnDiccionario(db, "xyzzy")).toEqual([]);
    await close();
  });
});

describe("buscarEnBiblioteca", () => {
  it("encuentra un término ya guardado, con su nivel y su traducción", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, {
      title: "Libro",
      pageStart: 1,
      pageEnd: 5,
      level: "B2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: [
        {
          term: "come across",
          type: "phrasal_verb",
          translation: "encontrarse con",
          context: "I came across an old photo.",
          example: "I came across a useful word.",
        },
      ],
    });

    const guardados = await buscarEnBiblioteca(db, "Come Across");
    expect(guardados).toHaveLength(1);
    expect(guardados[0].translation).toBe("encontrarse con");
    expect(guardados[0].level).toBe("B2");
    expect(guardados[0].senseHint).toBe("");
    await close();
  });

  it("devuelve vacío si el término no está en la biblioteca", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarEnBiblioteca(db, "come across")).toEqual([]);
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/diccionario-busqueda.test.ts`
Expected: FAIL — `buscarEnDiccionario` no está exportada

- [ ] **Step 3: Write minimal implementation**

Añadir a `db/repository/diccionario.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { dictionaryEntries, terms } from "@/db/schema";
import { variantesDelLema } from "@/lib/diccionario/lema";
import { normalizeTerm } from "@/lib/normalize";

export type AcepcionDiccionario = {
  id: number;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
};

export type TerminoGuardado = {
  id: number;
  term: string;
  translation: string;
  level: string;
  senseHint: string;
};

/**
 * Busca la forma escrita y, si no da nada, sus variantes de lema. Se prueban en
 * orden y se para en la primera que responde: mezclar los resultados de dos
 * lemas distintos enseñaría dos fichas casi iguales sin decir por qué.
 */
export async function buscarEnDiccionario(
  db: Database,
  termino: string,
): Promise<AcepcionDiccionario[]> {
  for (const clave of variantesDelLema(termino)) {
    const filas = await db
      .select({
        id: dictionaryEntries.id,
        term: dictionaryEntries.term,
        pos: dictionaryEntries.pos,
        gloss: dictionaryEntries.gloss,
        example: dictionaryEntries.example,
        translations: dictionaryEntries.translations,
      })
      .from(dictionaryEntries)
      .where(eq(dictionaryEntries.termNormalized, clave))
      .orderBy(dictionaryEntries.id);
    if (filas.length > 0) return filas;
  }
  return [];
}

/** Lo que el usuario ya tiene guardado de ese término, con todas sus acepciones. */
export async function buscarEnBiblioteca(
  db: Database,
  termino: string,
): Promise<TerminoGuardado[]> {
  return db
    .select({
      id: terms.id,
      term: terms.term,
      translation: terms.translation,
      level: terms.level,
      senseHint: terms.senseHint,
    })
    .from(terms)
    .where(inArray(terms.termNormalized, variantesDelLema(termino)))
    .orderBy(terms.id);
}
```

No importes aquí `normalizeTerm`: en esta tarea no se usa y el linter lo rechazaría. Entra en la Task 7.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/diccionario-busqueda.test.ts`
Expected: PASS, 5 pruebas

- [ ] **Step 5: Commit**

```bash
git add db/repository/diccionario.ts tests/db/diccionario-busqueda.test.ts
git commit -m "Buscar un término en el diccionario y en la biblioteca"
```

---

### Task 6: La pista, y que reextraer siga fusionando igual

**Esta es la tarea delicada del plan.** Cambia el índice único sobre el que se apoya toda la deduplicación, con 44 términos reales y su progreso de repaso dentro. La prueba de regresión se escribe **primero** y es la que da permiso para tocar nada.

**Files:**
- Modify: `db/schema.ts:30-45` (tabla `terms`)
- Modify: `db/repository/extraction.ts:69-72` (la consulta de deduplicación)
- Create: `drizzle/0004_*.sql`
- Test: `tests/db/extraction.test.ts` (añadir casos), `tests/db/schema.test.ts` (ajustar)

**Interfaces:**
- Produces: columna `terms.senseHint` (`sense_hint`, `text not null default ''`) e índice único `(term_normalized, sense_hint)`.

- [ ] **Step 1: Write the failing regression test**

Añadir a `tests/db/extraction.test.ts`:

```ts
it("reextraer el mismo PDF sigue fusionando tras añadir la pista", async () => {
  const { db, close } = await createTestDb();
  await saveExtraction(db, { ...base, items: [comeAcross] });
  const [antes] = await db.select().from(terms);

  // Se corrige la traducción a mano, como haría el usuario en la biblioteca.
  await db.update(terms).set({ translation: "toparse con" }).where(eq(terms.id, antes.id));

  const segunda = await saveExtraction(db, { ...base, items: [comeAcross] });

  expect(segunda.created).toBe(0);
  expect(segunda.merged).toBe(1);

  const guardados = await db.select().from(terms);
  expect(guardados).toHaveLength(1);
  expect(guardados[0].id).toBe(antes.id);
  expect(guardados[0].translation).toBe("toparse con"); // no se pisa
  expect(guardados[0].senseHint).toBe("");             // lo del PDF no lleva pista

  const cards = await db.select().from(cardStates);
  expect(cards).toHaveLength(1); // el progreso de repaso sigue siendo uno solo
  await close();
});

it("permite dos acepciones del mismo término con pistas distintas", async () => {
  const { db, close } = await createTestDb();
  const fila = {
    term: "bank",
    termNormalized: "bank",
    type: "word",
    translation: "banco",
    level: "B1",
  };
  await db.insert(terms).values({ ...fila, senseHint: "A financial institution." });
  await db.insert(terms).values({ ...fila, translation: "orilla", senseHint: "An edge of a river." });

  expect(await db.select().from(terms)).toHaveLength(2);
  await close();
});

it("sigue rechazando dos veces la misma acepción", async () => {
  const { db, close } = await createTestDb();
  const fila = {
    term: "bank",
    termNormalized: "bank",
    type: "word",
    translation: "banco",
    level: "B1",
    senseHint: "A financial institution.",
  };
  await db.insert(terms).values(fila);
  await expect(db.insert(terms).values(fila)).rejects.toThrow();
  await close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/extraction.test.ts`
Expected: FAIL — `senseHint` no existe en el esquema

- [ ] **Step 3: Add the column and change the index**

En `db/schema.ts`, dentro de `terms`:

```ts
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /**
     * El significado en inglés de la acepción guardada. Vacío en todo lo que
     * viene de un PDF, que es como se conserva el comportamiento anterior:
     * la clave de deduplicación de una extracción sigue siendo el término solo.
     * Se muestra en la cara delantera de la tarjeta para distinguir
     * `bank` → orilla de `bank` → banco sin adelantar la respuesta en español.
     */
    senseHint: text("sense_hint").notNull().default(""),
  },
  (table) => ({
    termNormalizedIdx: uniqueIndex("terms_term_normalized_idx").on(
      table.termNormalized,
      table.senseHint,
    ),
  }),
```

- [ ] **Step 4: Generate and READ the migration**

Run: `npx drizzle-kit generate`

Expected: `drizzle/0004_*.sql` con exactamente tres cosas, en este orden:

```sql
ALTER TABLE "terms" ADD COLUMN "sense_hint" text DEFAULT '' NOT NULL;
DROP INDEX "terms_term_normalized_idx";
CREATE UNIQUE INDEX "terms_term_normalized_idx" ON "terms" ("term_normalized","sense_hint");
```

**Si el SQL generado contiene `DROP TABLE`, `CREATE TABLE "terms"` o cualquier cosa que recree la tabla, párate.** Hay 44 términos reales con su estado de repaso: la migración solo puede añadir una columna y rehacer un índice.

- [ ] **Step 5: Point the dedup query at the new key**

En `db/repository/extraction.ts`, la consulta de la línea 69:

```ts
      const existing = await tx
        .select({ id: terms.id })
        .from(terms)
        // Explícito: una extracción de PDF solo fusiona con lo que tampoco
        // tiene pista. Una acepción concreta guardada desde el diccionario es
        // otra ficha, y no debe absorber la palabra genérica del libro.
        .where(and(eq(terms.termNormalized, key), eq(terms.senseHint, "")))
        .limit(1);
```

Añadir `and` al import de `drizzle-orm`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, todo verde. Si `tests/db/schema.test.ts:30-31` esperaba que insertar dos filas iguales fallara, sigue fallando igual (misma pista vacía), así que no debería requerir cambios; si los requiere, ajústalo sin debilitar la comprobación.

- [ ] **Step 7: Apply to the real database and check the 44 terms**

```bash
DATABASE_URL='...' npx drizzle-kit push
```

Comprobar después: `SELECT count(*) FROM terms;` sigue dando lo mismo que antes, y `SELECT count(*) FROM card_states;` también.

- [ ] **Step 8: Commit**

```bash
git add db/schema.ts db/repository/extraction.ts drizzle/ tests/db/
git commit -m "Permitir guardar dos acepciones del mismo término, con una pista en inglés"
```

---

### Task 7: Añadir un término desde el diccionario

**Files:**
- Modify: `db/repository/diccionario.ts`
- Modify: `app/api/terms/route.ts` (añadir `POST`; hoy solo tiene `GET`)
- Create: `lib/diccionario/tipo.ts`
- Test: `tests/db/diccionario-anadir.test.ts`, `tests/api/terms.test.ts` (añadir casos)

**Interfaces:**
- Produces:
  ```ts
  // lib/diccionario/tipo.ts
  export function tipoDeTermino(term: string, pos: string): "word" | "phrasal_verb" | "expression";
  // db/repository/diccionario.ts
  export const FUENTE_DICCIONARIO = "Diccionario";
  export async function anadirDesdeDiccionario(
    db: Database,
    entrada: {
      term: string;
      pos: string;
      gloss: string;
      example: string | null;
      translation: string;
      level: string;
    },
  ): Promise<{ termId: number; created: boolean }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/diccionario-anadir.test.ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { anadirDesdeDiccionario, FUENTE_DICCIONARIO } from "@/db/repository/diccionario";
import { tipoDeTermino } from "@/lib/diccionario/tipo";
import { sources, terms, termOccurrences, cardStates } from "@/db/schema";

const orilla = {
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "We sat on the bank.",
  translation: "orilla",
  level: "B1",
};

describe("tipoDeTermino", () => {
  it("una palabra suelta es 'word'", () => {
    expect(tipoDeTermino("bank", "noun")).toBe("word");
  });
  it("un verbo de varias palabras es 'phrasal_verb'", () => {
    expect(tipoDeTermino("come across", "verb")).toBe("phrasal_verb");
  });
  it("lo demás de varias palabras es 'expression'", () => {
    expect(tipoDeTermino("at the end of the day", "phrase")).toBe("expression");
  });
});

describe("anadirDesdeDiccionario", () => {
  it("crea el término, su aparición y su tarjeta de repaso", async () => {
    const { db, close } = await createTestDb();
    const { created } = await anadirDesdeDiccionario(db, orilla);

    expect(created).toBe(true);
    const [guardado] = await db.select().from(terms);
    expect(guardado.term).toBe("bank");
    expect(guardado.translation).toBe("orilla");
    expect(guardado.level).toBe("B1");
    expect(guardado.senseHint).toBe("An edge of a river.");

    expect(await db.select().from(cardStates)).toHaveLength(1);
    const [aparicion] = await db.select().from(termOccurrences);
    expect(aparicion.example).toBe("We sat on the bank.");
    await close();
  });

  it("cuelga las palabras de una única fuente 'Diccionario'", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    await anadirDesdeDiccionario(db, { ...orilla, gloss: "A financial institution.", translation: "banco" });

    const fuentes = await db.select().from(sources);
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0].title).toBe(FUENTE_DICCIONARIO);
    expect(fuentes[0].costUsd).toBe(0);
    await close();
  });

  it("guarda las dos acepciones de 'bank' como fichas distintas", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    await anadirDesdeDiccionario(db, { ...orilla, gloss: "A financial institution.", translation: "banco" });

    const guardados = await db.select().from(terms);
    expect(guardados).toHaveLength(2);
    expect(await db.select().from(cardStates)).toHaveLength(2);
    await close();
  });

  it("añadir dos veces la misma acepción no duplica", async () => {
    const { db, close } = await createTestDb();
    await anadirDesdeDiccionario(db, orilla);
    const segunda = await anadirDesdeDiccionario(db, orilla);

    expect(segunda.created).toBe(false);
    expect(await db.select().from(terms)).toHaveLength(1);
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/diccionario-anadir.test.ts`
Expected: FAIL — `anadirDesdeDiccionario` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/diccionario/tipo.ts
/**
 * El diccionario habla de categorías gramaticales; la biblioteca, de tres
 * tipos propios. Un verbo de varias palabras es un verbo frasal; cualquier
 * otra cosa de varias palabras, una expresión.
 */
export function tipoDeTermino(
  term: string,
  pos: string,
): "word" | "phrasal_verb" | "expression" {
  if (!term.trim().includes(" ")) return "word";
  return pos === "verb" ? "phrasal_verb" : "expression";
}
```

En `db/repository/diccionario.ts`:

```ts
import { and } from "drizzle-orm";
import { sources, termOccurrences, cardStates } from "@/db/schema";
import { tipoDeTermino } from "@/lib/diccionario/tipo";

/** Título de la fuente a la que se cuelga todo lo buscado a mano. */
export const FUENTE_DICCIONARIO = "Diccionario";

/**
 * Añade una acepción a la biblioteca. Todo lo buscado a mano cuelga de una
 * única fuente "Diccionario", con 0 páginas y coste 0, para que la biblioteca
 * pueda distinguir lo que se buscó de lo que salió de un PDF.
 */
export async function anadirDesdeDiccionario(
  db: Database,
  entrada: {
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translation: string;
    level: string;
  },
): Promise<{ termId: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const existentes = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.title, FUENTE_DICCIONARIO))
      .limit(1);

    const sourceId =
      existentes[0]?.id ??
      (
        await tx
          .insert(sources)
          .values({
            title: FUENTE_DICCIONARIO,
            pageStart: 0,
            pageEnd: 0,
            level: entrada.level,
          })
          .returning({ id: sources.id })
      )[0].id;

    const clave = normalizeTerm(entrada.term);
    const yaEsta = await tx
      .select({ id: terms.id })
      .from(terms)
      .where(and(eq(terms.termNormalized, clave), eq(terms.senseHint, entrada.gloss)))
      .limit(1);

    if (yaEsta.length > 0) return { termId: yaEsta[0].id, created: false };

    const [creado] = await tx
      .insert(terms)
      .values({
        term: entrada.term.trim(),
        termNormalized: clave,
        type: tipoDeTermino(entrada.term, entrada.pos),
        translation: entrada.translation,
        level: entrada.level,
        senseHint: entrada.gloss,
      })
      .returning({ id: terms.id });

    await tx.insert(cardStates).values({ termId: creado.id });
    await tx.insert(termOccurrences).values({
      termId: creado.id,
      sourceId,
      // El diccionario no da la frase en que se encontró la palabra: no hay
      // libro detrás. El significado en inglés es el contexto más honesto.
      context: entrada.gloss,
      example: entrada.example ?? "",
    });

    return { termId: creado.id, created: true };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/diccionario-anadir.test.ts`
Expected: PASS, 7 pruebas

- [ ] **Step 5: Add the route**

En `app/api/terms/route.ts`, junto al `GET` que ya existe:

```ts
import { anadirDesdeDiccionario } from "@/db/repository/diccionario";
import { isCefrLevel } from "@/lib/extraction-schema";

type PostBody = {
  term?: string;
  pos?: string;
  gloss?: string;
  example?: string | null;
  translation?: string;
  level?: string;
};

export async function POST(request: Request) {
  let body: PostBody | null;
  try {
    body = (await request.json()) as PostBody | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { term, pos, gloss, example, translation, level } = body ?? {};

  if (!term?.trim() || !pos?.trim() || !gloss?.trim()) {
    return NextResponse.json({ error: "Falta el término, su categoría o su significado." }, { status: 400 });
  }
  if (!translation?.trim()) {
    return NextResponse.json({ error: "Falta la traducción." }, { status: 400 });
  }
  // Sin nivel no se guarda: es la decisión del usuario, y un valor por defecto
  // llenaría la biblioteca de niveles que nadie ha elegido.
  if (!level || !isCefrLevel(level)) {
    return NextResponse.json({ error: "Elige un nivel del MCER." }, { status: 400 });
  }

  const resultado = await anadirDesdeDiccionario(getDb(), {
    term: term.trim(),
    pos,
    gloss: gloss.trim(),
    example: example?.trim() || null,
    translation: translation.trim(),
    level,
  });

  return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 });
}
```

- [ ] **Step 6: Test the route**

Añadir a `tests/api/terms.test.ts`, siguiendo el patrón de mockeo de `getDb` que ya usa ese fichero:

```ts
it("POST guarda la acepción y responde 201", async () => {
  const res = await POST(
    new Request("http://localhost/api/terms", {
      method: "POST",
      body: JSON.stringify({
        term: "bank",
        pos: "noun",
        gloss: "An edge of a river.",
        example: "We sat on the bank.",
        translation: "orilla",
        level: "B1",
      }),
    }),
  );
  expect(res.status).toBe(201);
});

it("POST sin nivel responde 400 y no guarda nada", async () => {
  const res = await POST(
    new Request("http://localhost/api/terms", {
      method: "POST",
      body: JSON.stringify({ term: "bank", pos: "noun", gloss: "x", translation: "orilla" }),
    }),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("nivel");
});
```

Run: `npx vitest run tests/api/terms.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/diccionario/tipo.ts db/repository/diccionario.ts app/api/terms/route.ts tests/
git commit -m "Añadir a la biblioteca una acepción buscada en el diccionario"
```

---

### Task 8: La ruta de búsqueda

**Files:**
- Create: `app/api/diccionario/route.ts`
- Test: `tests/api/diccionario.test.ts`

**Interfaces:**
- Consumes: `buscarEnDiccionario`, `buscarEnBiblioteca` de `@/db/repository/diccionario`
- Produces: `GET /api/diccionario?q=<término>` →
  ```ts
  {
    termino: string;
    enBiblioteca: TerminoGuardado[];
    acepciones: Array<AcepcionDiccionario & { yaGuardada: boolean }>;
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/diccionario.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { valor: null as unknown };
vi.mock("@/db/client", () => ({ getDb: () => db.valor }));

const buscarEnDiccionario = vi.fn();
const buscarEnBiblioteca = vi.fn();
vi.mock("@/db/repository/diccionario", () => ({
  buscarEnDiccionario: (...args: unknown[]) => buscarEnDiccionario(...args),
  buscarEnBiblioteca: (...args: unknown[]) => buscarEnBiblioteca(...args),
}));

const { GET } = await import("@/app/api/diccionario/route");

beforeEach(() => {
  buscarEnDiccionario.mockReset();
  buscarEnBiblioteca.mockReset();
});

const pide = (q: string) => GET(new Request(`http://localhost/api/diccionario?q=${encodeURIComponent(q)}`));

describe("GET /api/diccionario", () => {
  it("una búsqueda vacía responde 400 sin consultar nada", async () => {
    const res = await pide("   ");
    expect(res.status).toBe(400);
    expect(buscarEnDiccionario).not.toHaveBeenCalled();
  });

  it("marca la acepción que ya está en la biblioteca", async () => {
    buscarEnBiblioteca.mockResolvedValue([
      { id: 7, term: "bank", translation: "orilla", level: "B1", senseHint: "An edge of a river." },
    ]);
    buscarEnDiccionario.mockResolvedValue([
      { id: 1, term: "bank", pos: "noun", gloss: "An edge of a river.", example: null, translations: [] },
      { id: 2, term: "bank", pos: "noun", gloss: "A financial institution.", example: null, translations: [] },
    ]);

    const cuerpo = await (await pide("bank")).json();
    expect(cuerpo.acepciones[0].yaGuardada).toBe(true);
    expect(cuerpo.acepciones[1].yaGuardada).toBe(false);
    expect(cuerpo.enBiblioteca).toHaveLength(1);
  });

  it("un término desconocido responde 200 con las listas vacías", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);

    const res = await pide("xyzzy");
    expect(res.status).toBe(200);
    expect((await res.json()).acepciones).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/diccionario.test.ts`
Expected: FAIL — no existe `@/app/api/diccionario/route`

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/diccionario/route.ts
import { NextResponse } from "next/server";
import { buscarEnDiccionario, buscarEnBiblioteca } from "@/db/repository/diccionario";
import { getDb } from "@/db/client";

/**
 * Los escalones 1 y 2 de la búsqueda. **No llama a Claude nunca**: lo único que
 * cuesta dinero vive en /api/diccionario/afinar, aparte y a propósito.
 */
export async function GET(request: Request) {
  const termino = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!termino) {
    return NextResponse.json({ error: "Escribe una palabra para buscar." }, { status: 400 });
  }

  const db = getDb();
  const [enBiblioteca, acepciones] = await Promise.all([
    buscarEnBiblioteca(db, termino),
    buscarEnDiccionario(db, termino),
  ]);

  const pistasGuardadas = new Set(enBiblioteca.map((t) => t.senseHint));
  return NextResponse.json({
    termino,
    enBiblioteca,
    acepciones: acepciones.map((a) => ({ ...a, yaGuardada: pistasGuardadas.has(a.gloss) })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/diccionario.test.ts`
Expected: PASS, 3 pruebas

- [ ] **Step 5: Commit**

```bash
git add app/api/diccionario/route.ts tests/api/diccionario.test.ts
git commit -m "Añadir la ruta de búsqueda del diccionario"
```

---

### Task 9: La pantalla

**Files:**
- Create: `app/diccionario/page.tsx`
- Create: `components/BuscadorDiccionario.tsx`
- Modify: `app/extraer/page.tsx:11-17`, `app/biblioteca/page.tsx:11-14`, `app/repaso/page.tsx:7-10` (añadir el enlace en la navegación)
- Test: `tests/buscador-diccionario.test.ts`

**Interfaces:**
- Consumes: `GET /api/diccionario`, `POST /api/terms`; `Boton`, `Campo`, `Tarjeta` de `components/ui/`
- Produces: `export function BuscadorDiccionario()` — componente de cliente, sin props.

- [ ] **Step 1: Write the failing test**

**Sigue la convención de este proyecto:** `vitest.config.mts` usa `environment: "node"`, sin `jsdom` ni `@testing-library`. `tests/sesion-repaso-ajustes.test.ts` lo explica y marca el camino: se **exporta del módulo del componente la lógica pura** y se prueba esa, no el árbol de React. No instales jsdom ni testing-library para esta tarea.

```ts
// tests/buscador-diccionario.test.ts
import { describe, it, expect, vi } from "vitest";
import { buscarTermino, anadirAcepcion } from "@/components/BuscadorDiccionario";

const acepcion = {
  id: 1,
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "We sat on the bank.",
  translations: ["orilla"],
  yaGuardada: false,
};

const resultado = { termino: "bank", enBiblioteca: [], acepciones: [acepcion] };

function fetchQueDevuelve(cuerpo: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(cuerpo), { status }));
}

describe("buscarTermino", () => {
  it("pide la búsqueda con el término escapado", async () => {
    const fetchFalso = fetchQueDevuelve(resultado);
    await buscarTermino("bite off more than you can chew", fetchFalso as unknown as typeof fetch);

    expect(String(fetchFalso.mock.calls[0][0])).toBe(
      "/api/diccionario?q=bite%20off%20more%20than%20you%20can%20chew",
    );
  });

  it("devuelve las acepciones", async () => {
    const devuelto = await buscarTermino("bank", fetchQueDevuelve(resultado) as unknown as typeof fetch);
    expect(devuelto.acepciones[0].gloss).toBe("An edge of a river.");
  });

  it("convierte el error del servidor en un mensaje legible", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Escribe una palabra para buscar." }, 400);
    await expect(
      buscarTermino("  ", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Escribe una palabra para buscar.");
  });

  it("un fallo de red no se propaga sin mensaje: el campo no puede quedarse colgado", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      buscarTermino("bank", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/no se pudo buscar/i);
  });
});

describe("anadirAcepcion", () => {
  it("manda el término, su significado como pista y el nivel elegido", async () => {
    const fetchFalso = fetchQueDevuelve({ termId: 3, created: true }, 201);
    await anadirAcepcion(acepcion, "B1", fetchFalso as unknown as typeof fetch);

    const [url, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/terms");
    expect(JSON.parse(String(opciones.body))).toMatchObject({
      term: "bank",
      pos: "noun",
      gloss: "An edge of a river.",
      translation: "orilla",
      level: "B1",
    });
  });

  it("sin nivel no llama al servidor", async () => {
    const fetchFalso = fetchQueDevuelve({}, 201);
    await expect(
      anadirAcepcion(acepcion, "", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/nivel/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("propaga el error del servidor con su mensaje", async () => {
    const fetchFalso = fetchQueDevuelve({ error: "Elige un nivel del MCER." }, 400);
    await expect(
      anadirAcepcion(acepcion, "B1", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Elige un nivel del MCER.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/buscador-diccionario.test.ts`
Expected: FAIL — no existe `@/components/BuscadorDiccionario`

- [ ] **Step 3: Write the component**

```tsx
// components/BuscadorDiccionario.tsx
"use client";

import { useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Campo } from "@/components/ui/Campo";
import { Tarjeta } from "@/components/ui/Tarjeta";

const NIVELES = ["A1", "A2", "B1", "B2", "C1", "C2"];

type Acepcion = {
  id: number;
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translations: string[];
  yaGuardada: boolean;
};

type Resultado = {
  termino: string;
  enBiblioteca: { id: number; term: string; translation: string; level: string; senseHint: string }[];
  acepciones: Acepcion[];
};

/**
 * Extraídas del componente y exportadas a propósito: este proyecto prueba en
 * `environment: "node"`, sin jsdom, así que la lógica que puede fallar —la
 * petición, el error del servidor, la validación del nivel— vive en funciones
 * puras que sí se pueden probar. El componente solo pinta y guarda estado.
 */
export async function buscarTermino(
  consulta: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Resultado> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/diccionario?q=${encodeURIComponent(consulta.trim())}`);
  } catch {
    // Un fallo de red sin mensaje dejaría el formulario deshabilitado para
    // siempre, sin decirle nada al usuario.
    throw new Error("No se pudo buscar: comprueba la conexión.");
  }
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(cuerpo.error ?? "No se pudo buscar.");
  return cuerpo as Resultado;
}

export async function anadirAcepcion(
  acepcion: Acepcion,
  nivel: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // Sin nivel no se guarda, y se para aquí: que el servidor conteste 400 a algo
  // que la pantalla ya sabe que falta es un viaje perdido.
  if (!nivel) throw new Error("Elige un nivel antes de añadir.");

  let res: Response;
  try {
    res = await fetchImpl("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: acepcion.term,
        pos: acepcion.pos,
        gloss: acepcion.gloss,
        example: acepcion.example,
        translation: acepcion.translations.join(", "),
        level: nivel,
      }),
    });
  } catch {
    throw new Error("No se pudo añadir: comprueba la conexión.");
  }
  if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo añadir.");
}

export function BuscadorDiccionario() {
  const [consulta, setConsulta] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [niveles, setNiveles] = useState<Record<number, string>>({});
  const [guardadas, setGuardadas] = useState<Set<number>>(new Set());

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!consulta.trim()) return;
    setBuscando(true);
    setError("");
    setGuardadas(new Set());
    try {
      setResultado(await buscarTermino(consulta));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar.");
      setResultado(null);
    } finally {
      setBuscando(false);
    }
  }

  async function anadir(acepcion: Acepcion) {
    try {
      await anadirAcepcion(acepcion, niveles[acepcion.id] ?? "");
      setGuardadas((previas) => new Set(previas).add(acepcion.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo añadir.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={buscar} className="flex items-end gap-3">
        <Campo
          id="consulta"
          etiqueta="Palabra o expresión"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          className="flex-1"
        />
        <Boton type="submit" disabled={buscando || !consulta.trim()}>
          {buscando ? "Buscando…" : "Buscar"}
        </Boton>
      </form>

      {error && <p role="alert">{error}</p>}

      {resultado && resultado.acepciones.length === 0 && (
        <p>
          <strong>{resultado.termino}</strong> no está en el diccionario. Puedes
          probar con otra forma de la palabra.
        </p>
      )}

      {resultado?.acepciones.map((acepcion) => (
        <Tarjeta key={acepcion.id}>
          <div className="flex flex-col gap-3">
            <p>
              <strong>{acepcion.term}</strong> · {acepcion.pos}
            </p>
            <p>{acepcion.gloss}</p>
            {acepcion.example && <p className="italic">{acepcion.example}</p>}
            {acepcion.translations.length > 0 ? (
              <p>→ {acepcion.translations.join(", ")}</p>
            ) : (
              <p>Sin traducción al español.</p>
            )}

            {acepcion.yaGuardada || guardadas.has(acepcion.id) ? (
              <p>Ya está en tu repaso.</p>
            ) : (
              <div className="flex items-end gap-3">
                <Campo
                  id={`nivel-${acepcion.id}`}
                  etiqueta="Nivel"
                  value={niveles[acepcion.id] ?? ""}
                  onChange={(e) =>
                    setNiveles((previos) => ({ ...previos, [acepcion.id]: e.target.value }))
                  }
                  opciones={[
                    { valor: "", etiqueta: "Elige…" },
                    ...NIVELES.map((n) => ({ valor: n, etiqueta: n })),
                  ]}
                />
                <Boton
                  onClick={() => anadir(acepcion)}
                  disabled={!niveles[acepcion.id] || acepcion.translations.length === 0}
                >
                  Añadir
                </Boton>
              </div>
            )}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}
```

```tsx
// app/diccionario/page.tsx
import Link from "next/link";
import { BuscadorDiccionario } from "@/components/BuscadorDiccionario";

export default function DiccionarioPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <nav className="flex items-baseline gap-4">
        <Link href="/repaso" className="inline-flex min-h-12 items-center underline">
          Repasar
        </Link>
        <Link href="/biblioteca" className="inline-flex min-h-12 items-center underline">
          Biblioteca
        </Link>
      </nav>
      <h1>Diccionario</h1>
      <BuscadorDiccionario />
    </main>
  );
}
```

Y añadir en los `<nav>` de `app/extraer/page.tsx`, `app/biblioteca/page.tsx` y `app/repaso/page.tsx`, con las mismas clases que los enlaces vecinos:

```tsx
        <Link href="/diccionario" className="inline-flex min-h-12 items-center underline">
          Diccionario
        </Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/buscador-diccionario.test.ts`
Expected: PASS, 7 pruebas

- [ ] **Step 5: See it in the browser**

Arrancar el servidor de desarrollo, entrar en `/diccionario`, buscar `bank` y comprobar que salen las siete acepciones; buscar `bite off more than you can chew` y comprobar que **encuentra** la ficha guardada con *one*. Añadir una con nivel B1 y verla aparecer en `/biblioteca` filtrando por la fuente "Diccionario".

- [ ] **Step 6: Commit**

```bash
git add app/diccionario components/BuscadorDiccionario.tsx app/extraer/page.tsx app/biblioteca/page.tsx app/repaso/page.tsx tests/buscador-diccionario.test.ts
git commit -m "Añadir la pantalla del diccionario"
```

---

### Task 10: El traductor gratuito, con caché

Del 1,8 % de entradas que traen español, el resto se traduce con MyMemory —el único servicio gratuito que seguía en pie el 2026-09-07— **con el término suelto, nunca pegado a su definición**: probado, así devuelve *"venir a través"* para *come across*.

**Files:**
- Create: `lib/diccionario/traductor.ts`
- Modify: `db/repository/diccionario.ts` (cachear), `app/api/diccionario/route.ts` (usarlo)
- Test: `tests/diccionario/traductor.test.ts`, `tests/db/diccionario-traduccion.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Traductor = (termino: string) => Promise<string[]>;
  export function crearTraductorMyMemory(fetchImpl?: typeof fetch): Traductor;
  // db/repository/diccionario.ts
  export async function traducirSiFalta(
    db: Database,
    acepciones: AcepcionDiccionario[],
    traductor: Traductor,
  ): Promise<AcepcionDiccionario[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/diccionario/traductor.test.ts
import { describe, it, expect, vi } from "vitest";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";

const respuestaOk = {
  responseData: { translatedText: "renuente" },
  matches: [{ translation: "reacio" }, { translation: "renuente" }, { translation: "" }],
};

describe("crearTraductorMyMemory", () => {
  it("manda el término solo, nunca pegado a su definición", async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(respuestaOk)));
    await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant");

    const url = String(fetchFalso.mock.calls[0][0]);
    expect(url).toContain("q=reluctant");
    expect(url).toContain("langpair=en%7Ces");
    expect(url).not.toContain("Not+wanting");
  });

  it("devuelve la traducción principal y las alternativas, sin repetir ni vacías", async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(respuestaOk)));
    const traducciones = await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant");
    expect(traducciones).toEqual(["renuente", "reacio"]);
  });

  it("si el servicio falla devuelve vacío en vez de reventar la búsqueda", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant")).toEqual([]);
  });

  it("una respuesta con error HTTP también devuelve vacío", async () => {
    const fetchFalso = vi.fn(async () => new Response("nope", { status: 503 }));
    expect(await crearTraductorMyMemory(fetchFalso as unknown as typeof fetch)("reluctant")).toEqual([]);
  });
});
```

```ts
// tests/db/diccionario-traduccion.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarEnDiccionario, traducirSiFalta } from "@/db/repository/diccionario";
import { dictionaryEntries } from "@/db/schema";

describe("traducirSiFalta", () => {
  it("traduce solo lo que no tiene español y lo guarda", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values([
      { termNormalized: "free", term: "free", pos: "adj", gloss: "Unconstrained.", translations: ["libre"] },
      { termNormalized: "free", term: "free", pos: "adj", gloss: "Without cost.", translations: [] },
    ]);

    const traductor = vi.fn(async () => ["gratis", "gratuito"]);
    const acepciones = await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);

    expect(traductor).toHaveBeenCalledTimes(1);
    expect(acepciones[0].translations).toEqual(["libre"]);
    expect(acepciones[1].translations).toEqual(["gratis", "gratuito"]);

    const guardadas = await db.select().from(dictionaryEntries);
    expect(guardadas[1].translations).toEqual(["gratis", "gratuito"]);
    expect(guardadas[1].translationSource).toBe("mymemory");
    await close();
  });

  it("la segunda búsqueda ya no llama al traductor", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "free", term: "free", pos: "adj", gloss: "Without cost.", translations: [],
    });

    const traductor = vi.fn(async () => ["gratis"]);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);
    await traducirSiFalta(db, await buscarEnDiccionario(db, "free"), traductor);

    expect(traductor).toHaveBeenCalledTimes(1);
    await close();
  });

  it("si el traductor no devuelve nada, la acepción se queda sin español y no se marca", async () => {
    const { db, close } = await createTestDb();
    await db.insert(dictionaryEntries).values({
      termNormalized: "xyzzy", term: "xyzzy", pos: "noun", gloss: "A magic word.", translations: [],
    });

    await traducirSiFalta(db, await buscarEnDiccionario(db, "xyzzy"), async () => []);

    const [fila] = await db.select().from(dictionaryEntries);
    expect(fila.translations).toEqual([]);
    expect(fila.translationSource).toBeNull();
    await close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/diccionario/traductor.test.ts tests/db/diccionario-traduccion.test.ts`
Expected: FAIL — no existen `crearTraductorMyMemory` ni `traducirSiFalta`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/diccionario/traductor.ts
export type Traductor = (termino: string) => Promise<string[]>;

/**
 * MyMemory era, el 2026-09-07, el único traductor gratuito en pie: las
 * instancias públicas de LibreTranslate y las tres de Lingva probadas estaban
 * caídas. Cuota anónima: 5.000 caracteres al día; un término son unos diez.
 *
 * Se manda **el término solo**. Mandarlo junto a su definición para desambiguar
 * parece buena idea y no lo es: "come across: to give an impression" vuelve
 * traducido como "venir a través", partiendo el verbo frasal.
 *
 * Un fallo del servicio devuelve una lista vacía, nunca una excepción: que un
 * tercero se caiga no puede tumbar la búsqueda, que ya tiene el significado y
 * el ejemplo listos para enseñar.
 */
export function crearTraductorMyMemory(fetchImpl: typeof fetch = fetch): Traductor {
  return async (termino: string) => {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", termino);
    url.searchParams.set("langpair", "en|es");

    try {
      const res = await fetchImpl(url.toString());
      if (!res.ok) return [];
      const cuerpo = (await res.json()) as {
        responseData?: { translatedText?: string };
        matches?: { translation?: string }[];
      };

      const candidatas = [
        cuerpo.responseData?.translatedText ?? "",
        ...(cuerpo.matches ?? []).map((m) => m.translation ?? ""),
      ];

      const vistas = new Set<string>();
      const traducciones: string[] = [];
      for (const bruta of candidatas) {
        const limpia = bruta.trim();
        if (!limpia || vistas.has(limpia.toLowerCase())) continue;
        vistas.add(limpia.toLowerCase());
        traducciones.push(limpia);
        if (traducciones.length === 3) break;
      }
      return traducciones;
    } catch {
      return [];
    }
  };
}
```

En `db/repository/diccionario.ts`:

```ts
import type { Traductor } from "@/lib/diccionario/traductor";

/**
 * Rellena el español que falte y lo guarda. Una palabra se traduce **una vez en
 * la vida**: es lo que hace que caerse el servicio ajeno sea un problema
 * pequeño en vez de una función rota.
 */
export async function traducirSiFalta(
  db: Database,
  acepciones: AcepcionDiccionario[],
  traductor: Traductor,
): Promise<AcepcionDiccionario[]> {
  // Un término puede tener varias acepciones sin español; se traduce el término
  // una sola vez y el resultado sirve para todas.
  const cache = new Map<string, string[]>();

  const resultado: AcepcionDiccionario[] = [];
  for (const acepcion of acepciones) {
    if (acepcion.translations.length > 0) {
      resultado.push(acepcion);
      continue;
    }
    const clave = acepcion.term.toLowerCase();
    const traducciones = cache.get(clave) ?? (await traductor(acepcion.term));
    cache.set(clave, traducciones);

    if (traducciones.length > 0) {
      await db
        .update(dictionaryEntries)
        .set({ translations: traducciones, translationSource: "mymemory" })
        .where(eq(dictionaryEntries.id, acepcion.id));
    }
    resultado.push({ ...acepcion, translations: traducciones });
  }
  return resultado;
}
```

Y en `app/api/diccionario/route.ts`, entre la búsqueda y la respuesta:

```ts
import { traducirSiFalta } from "@/db/repository/diccionario";
import { crearTraductorMyMemory } from "@/lib/diccionario/traductor";

  const conEspanol = await traducirSiFalta(db, acepciones, crearTraductorMyMemory());
```

y usar `conEspanol` en vez de `acepciones` al construir la respuesta.

- [ ] **Step 4: Update the route test from Task 8**

La ruta pasa a importar `traducirSiFalta`, y `tests/api/diccionario.test.ts` mockea el módulo entero: sin esto, el mock se queda corto y las tres pruebas de la Task 8 fallan con "traducirSiFalta is not a function". Añadir al `vi.mock` de ese fichero:

```ts
const traducirSiFalta = vi.fn(async (_db: unknown, acepciones: unknown) => acepciones);
vi.mock("@/db/repository/diccionario", () => ({
  buscarEnDiccionario: (...args: unknown[]) => buscarEnDiccionario(...args),
  buscarEnBiblioteca: (...args: unknown[]) => buscarEnBiblioteca(...args),
  traducirSiFalta: (...args: unknown[]) => traducirSiFalta(...args),
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/diccionario/ tests/db/diccionario-traduccion.test.ts tests/api/diccionario.test.ts`
Expected: PASS, 10 pruebas

- [ ] **Step 6: Commit**

```bash
git add lib/diccionario/traductor.ts db/repository/diccionario.ts app/api/diccionario/route.ts tests/
git commit -m "Traducir con MyMemory lo que Wikcionario no trae, y cachearlo"
```

---

### Task 11: La pista en la tarjeta de repaso

Sin esto, guardar `bank` dos veces produce dos tarjetas idénticas por delante y el repaso se vuelve una lotería. La pista va **en inglés** a propósito: distingue las acepciones sin adelantar la respuesta en español.

**Files:**
- Modify: `db/repository/review.ts` (el `select` de `getDueQueue` y el tipo `CartaCola`)
- Modify: `components/SesionRepaso.tsx` (la cara delantera de la tarjeta)
- Test: `tests/db/review-queue.test.ts` (añadir dos casos). La parte visual —que la pista se recorte a una línea— se comprueba a ojo en el navegador: sin jsdom no hay forma honesta de probarla, y fingir que sí la hay es peor que decirlo.

**Interfaces:**
- Produces: `CartaCola.senseHint: string`

- [ ] **Step 1: Write the failing test**

Se añade a `tests/db/review-queue.test.ts`, usando los ayudantes que ese fichero ya tiene (`base`, `madurar`, `AHORA`, y la variable de módulo `db`):

```ts
it("la cola trae la pista de la acepción", async () => {
  const { termId } = await anadirDesdeDiccionario(db, {
    term: "bank",
    pos: "noun",
    gloss: "An edge of a river.",
    example: "We sat on the bank.",
    translation: "orilla",
    level: "B1",
  });
  await madurar([termId]);

  const { cartas } = await getDueQueue(db, { now: AHORA });
  expect(cartas).toHaveLength(1);
  expect(cartas[0].senseHint).toBe("An edge of a river.");
});

it("lo extraído de un PDF no lleva pista", async () => {
  await saveExtraction(db, { ...base, items: [termino(1)] });
  const [tarjeta] = await db.select().from(cardStates);
  await madurar([tarjeta.termId]);

  const { cartas } = await getDueQueue(db, { now: AHORA });
  expect(cartas[0].senseHint).toBe("");
});
```

Añadir `anadirDesdeDiccionario` a los imports del fichero.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/review-queue.test.ts`
Expected: FAIL — `senseHint` no está en el tipo ni en el `select`

- [ ] **Step 3: Write minimal implementation**

Añadir `senseHint: terms.senseHint` al `select` de `getDueQueue`, `senseHint: string` al tipo `CartaCola`, y `senseHint: f.senseHint` al construir cada `carta`.

En `components/SesionRepaso.tsx`, bajo el término en la cara delantera:

```tsx
{carta.senseHint && (
  <p
    className="line-clamp-1 text-texto-tenue"
    style={{ fontSize: "var(--tamano-1)" }}
    title={carta.senseHint}
  >
    {carta.senseHint}
  </p>
)}
```

`line-clamp-1` es deliberado: las glosas de Wikcionario llegan a ocupar cuatro líneas —la de *dictionary* las ocupa— y una pista que tapa la palabra no es una pista. Se guarda entera y se enseña recortada; el texto completo queda en el `title`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/repository/review.ts components/SesionRepaso.tsx tests/
git commit -m "Enseñar la pista en inglés en la cara delantera de la tarjeta"
```

---

### Task 12: El botón de afinar con Claude

El único punto de toda la funcionalidad que cuesta dinero. Va en su propia ruta para que se vea de un vistazo que ninguna otra llama a la API.

**Files:**
- Create: `app/api/diccionario/afinar/route.ts`
- Create: `lib/diccionario/afinar.ts`
- Modify: `components/BuscadorDiccionario.tsx`
- Test: `tests/diccionario/afinar.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function afinarTraduccion(params: {
    term: string;
    gloss: string;
    cliente?: { messages: { parse: (...args: unknown[]) => Promise<unknown> } };
  }): Promise<{ translations: string[]; costUsd: number }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/diccionario/afinar.test.ts
import { describe, it, expect, vi } from "vitest";
import { afinarTraduccion } from "@/lib/diccionario/afinar";

const respuesta = {
  parsed_output: { translations: ["reacio", "poco dispuesto"] },
  usage: { input_tokens: 120, output_tokens: 30 },
};

describe("afinarTraduccion", () => {
  it("manda el término con su significado y devuelve las traducciones", async () => {
    const parse = vi.fn(async () => respuesta);
    const resultado = await afinarTraduccion({
      term: "reluctant",
      gloss: "Not wanting to take some action.",
      cliente: { messages: { parse } },
    });

    expect(resultado.translations).toEqual(["reacio", "poco dispuesto"]);
    const enviado = JSON.stringify(parse.mock.calls[0][0]);
    expect(enviado).toContain("reluctant");
    expect(enviado).toContain("Not wanting to take some action.");
  });

  it("calcula el coste con los precios de claude-opus-5", async () => {
    const parse = vi.fn(async () => respuesta);
    const { costUsd } = await afinarTraduccion({
      term: "reluctant",
      gloss: "x",
      cliente: { messages: { parse } },
    });
    // 120 * 5/1e6 + 30 * 25/1e6
    expect(costUsd).toBeCloseTo(0.00135, 8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diccionario/afinar.test.ts`
Expected: FAIL — no existe `@/lib/diccionario/afinar`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/diccionario/afinar.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { estimateCostUsd } from "@/lib/cost";

export const afinarSchema = z.object({
  translations: z.array(z.string()).min(1).max(4),
});

/** Lo mínimo que hace falta de un cliente de Anthropic, para poder inyectarlo. */
type ClienteAfinar = {
  messages: {
    parse: (params: Record<string, unknown>) => Promise<{
      parsed_output: z.infer<typeof afinarSchema>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
};

/**
 * El único punto de todo el diccionario que cuesta dinero, y solo se llega aquí
 * si el usuario pulsa el botón.
 *
 * Se manda el término **con su significado en inglés**, que es lo que resuelve
 * la ambigüedad: sin él, "bank" devuelve la acepción financiera y punto. Esto
 * es exactamente lo contrario que con el traductor automático, donde pegar la
 * definición rompía el resultado; un modelo de lenguaje sí sabe distinguir un
 * contexto de un texto a traducir.
 */
export async function afinarTraduccion(params: {
  term: string;
  gloss: string;
  cliente?: ClienteAfinar;
}): Promise<{ translations: string[]; costUsd: number }> {
  const cliente = params.cliente ?? (new Anthropic() as unknown as ClienteAfinar);

  const respuesta = await cliente.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content:
          `Término en inglés: ${params.term}\n` +
          `Significado, en inglés: ${params.gloss}\n\n` +
          "Da las traducciones al español de ese término **en esa acepción concreta**: " +
          "las que un profesor pondría en una tarjeta de vocabulario. " +
          "Entre una y cuatro, de más a menos habitual. Solo las traducciones, sin explicaciones.",
      },
    ],
    output_format: zodOutputFormat(afinarSchema, "traducciones"),
  });

  return {
    translations: respuesta.parsed_output.translations,
    costUsd: estimateCostUsd(respuesta.usage),
  };
}
```

```ts
// app/api/diccionario/afinar/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { afinarTraduccion } from "@/lib/diccionario/afinar";
import { dictionaryEntries } from "@/db/schema";
import { getDb } from "@/db/client";

export const maxDuration = 60;

type Body = { entryId?: number };

/**
 * Aislada en su propia ruta a propósito: así se ve de un vistazo que ninguna
 * otra ruta del diccionario llama a la API de Claude.
 */
export async function POST(request: Request) {
  let body: Body | null;
  try {
    body = (await request.json()) as Body | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }
  const { entryId } = body ?? {};
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ error: "Falta la acepción que afinar." }, { status: 400 });
  }

  const db = getDb();
  const [entrada] = await db
    .select()
    .from(dictionaryEntries)
    .where(eq(dictionaryEntries.id, entryId as number))
    .limit(1);

  if (!entrada) {
    return NextResponse.json({ error: "Esa acepción no existe." }, { status: 404 });
  }

  let afinada;
  try {
    afinada = await afinarTraduccion({ term: entrada.term, gloss: entrada.gloss });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo afinar la traducción: ${detalle}` }, { status: 502 });
  }

  await db
    .update(dictionaryEntries)
    .set({ translations: afinada.translations, translationSource: "claude" })
    .where(eq(dictionaryEntries.id, entrada.id));

  return NextResponse.json(afinada);
}
```

En `components/BuscadorDiccionario.tsx`, otra función pura exportada y un botón secundario en cada acepción:

```ts
export async function afinarConIA(
  entryId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl("/api/diccionario/afinar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId }),
  });
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(cuerpo.error ?? "No se pudo afinar.");
  return cuerpo.translations as string[];
}
```

```tsx
<Boton variante="secundario" onClick={() => afinar(acepcion)}>
  Afinar con IA
</Boton>
<p style={{ fontSize: "var(--tamano-1)" }}>
  Afinar cuesta unos céntimos. Todo lo demás de esta pantalla es gratis.
</p>
```

El manejador `afinar` sustituye las traducciones de esa ficha en el estado, igual que `anadir` marca la ficha como guardada.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diccionario/afinar.test.ts`
Expected: PASS, 2 pruebas

- [ ] **Step 5: Full check and commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add lib/diccionario/afinar.ts app/api/diccionario components/BuscadorDiccionario.tsx tests/
git commit -m "Añadir el botón de afinar la traducción con Claude"
```

---

## Cierre

- [ ] **Documentar en el README** la pantalla del diccionario, la fuente "Diccionario", el comando de carga y que el diccionario **no consume API** salvo el botón de afinar. Seguir el tono de las secciones que ya hay.
- [ ] **Prueba manual, la que decide si esto vale:** buscar cinco palabras propias, añadirlas con su nivel, y comprobar al día siguiente que aparecen en el repaso. Si el vocabulario que produce no sirve, la funcionalidad no está terminada.
