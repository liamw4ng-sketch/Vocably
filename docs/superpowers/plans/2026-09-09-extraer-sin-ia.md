# Extraer sin IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a Vocably un segundo botón de extracción, gratis, que saca vocabulario de un PDF sin llamar a la IA: el navegador lee el texto, el servidor lo cruza con el diccionario y con un listado de niveles del MCER, y el usuario marca lo que quiere aprender.

**Architecture:** El PDF se lee **en el navegador** y no sale del teléfono; al servidor solo viajan las cadenas candidatas con la frase en que aparecieron (40 KB para cinco páginas). El servidor las cruza con cuatro orígenes que ya existen —el diccionario inglés, los significados en español, la biblioteca— más una tabla nueva de niveles, y devuelve las que pasan el filtro: palabras sueltas de tu nivel para arriba, y verbos frasales y expresiones siempre.

**Tech Stack:** Next.js 16.3.4 (App Router), TypeScript estricto, Drizzle ORM sobre Neon Postgres, Vitest con PGlite en memoria, Tailwind 4, y **`pdfjs-dist` 6.3.289** como única dependencia nueva.

**Spec:** `docs/superpowers/specs/2026-09-09-extraer-sin-ia-design.md`

## Global Constraints

- **Todo el código que escribas en español**: nombres, comentarios, mensajes de error y textos de pantalla. Los nombres de columna de la base van en inglés (`term_normalized`), que es la convención ya establecida en `db/schema.ts`.
- **TDD sin excepciones.** Prueba primero, verla fallar, implementación mínima, verla pasar, commit.
- **Las pruebas corren en `environment: "node"`, sin jsdom y sin `@testing-library`.** Es deliberado: la lógica que puede fallar se extrae de los componentes como función pura exportada y se prueba así. **No añadas jsdom ni testing-library**, por muy componente que sea la tarea 9.
- **Cero `eslint-disable` en el proyecto.** Si una regla molesta, rediseña; no la silencies.
- **NUNCA ejecutes `npx prettier`.** No es dependencia del proyecto ni hay configuración: reformatearía ficheros enteros.
- **No toques la base de datos real ni uses `DATABASE_URL`.** Las migraciones y las cargas las lanza el usuario. Las pruebas usan PGlite en memoria.
- **Ninguna prueba sale a la red.**
- **La suite se ejecuta con `npx vitest run --no-file-parallelism`.** Con el paralelismo por defecto esta máquina da fallos falsos por timeout al arrancar PGlite, en ficheros que no tienes tocados. Partes de **492 pruebas en 45 ficheros**.
- Antes de cada commit: la suite, `npx tsc --noEmit` y `npx eslint .`.
- Este Next tiene cambios que quizá no conozcas: si tocas algo del framework, lee la guía correspondiente en `node_modules/next/dist/docs/`.

## Decisiones que la especificación no fijó, y que fijo aquí

Están aquí y no enterradas en una tarea para que el usuario pueda discutirlas.

1. **Qué acepción se guarda.** Una palabra tiene varias acepciones en el diccionario (`bank` tiene siete). Al marcarla en la extracción **se guarda la primera**, que es el sentido principal de Wikcionario, y su significado en inglés va como `senseHint`, igual que hace `anadirDesdeDiccionario` hoy. Es más basto que elegir a mano, y es a propósito: la pantalla del diccionario ya existe para afinar una palabra concreta, y una extracción de cuarenta candidatas no puede pedir cuarenta desambiguaciones.
2. **Qué nivel tiene una forma que aparece con varias categorías.** El listado del MCER puede dar a `study` un nivel como sustantivo y otro como verbo. Se toma **el más bajo**, porque es el nivel al que el estudiante se topa con esa palabra por primera vez. Es también el criterio con el que se midieron las cifras de la especificación §5.
3. **Las variantes de escritura se desdoblan.** 213 entradas del listado traen varias grafías separadas por barra (`airplane/aeroplane`, `adviser/advisor`). Cada grafía se guarda como su propia fila; si no, `airplane` se quedaría sin nivel.

---

## Estructura de ficheros

**Se crean:**

| Fichero | Responsabilidad |
|---|---|
| `lib/nivel/mcer.ts` | Puro: los seis niveles, comparar contra un suelo, traducir la categoría gramatical del listado a la del proyecto, y leer una línea del CSV. Sin base de datos. |
| `db/repository/nivel.ts` | Cargar `cefr_levels` y consultar el nivel de un montón de términos. |
| `scripts/cargar-niveles.ts` | El cargador de línea de órdenes, hermano de los dos que ya existen. |
| `lib/extraer/candidatas.ts` | Puro: partir un texto en palabras y grupos de dos y tres, cada uno con la frase en que apareció. |
| `lib/extraer/pdf-texto.ts` | Sacar el texto de un rango de páginas con `pdfjs-dist`. Solo cliente. |
| `db/repository/extraer.ts` | La consulta que cruza los cuatro orígenes y aplica el filtro. |
| `app/api/extraer-sin-ia/route.ts` | La ruta. |
| `components/ExtraerSinIA.tsx` | La pantalla: la lista para marcar. |
| `tests/nivel/mcer.test.ts` · `tests/extraer/candidatas.test.ts` | Pruebas de los módulos puros. |
| `tests/db/nivel.test.ts` · `tests/db/extraer.test.ts` | Pruebas con PGlite. |
| `tests/api/extraer-sin-ia.test.ts` · `tests/extraer-sin-ia-pantalla.test.ts` | Ruta y funciones puras de la pantalla. |

**Se modifican:** `db/schema.ts` (la tabla), `db/repository/diccionario.ts` (guardar en lote), `app/api/terms/route.ts` (aceptar el lote), `app/extraer/page.tsx` (los dos botones), `package.json`, `README.md`.

---

### Task 1: La tabla `cefr_levels`

**Files:**
- Modify: `db/schema.ts` (al final)
- Create: `drizzle/0007_*.sql` (lo genera drizzle-kit)
- Test: `tests/db/nivel-schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `cefrLevels` exportado de `@/db/schema`, columnas `id`, `termNormalized`, `term`, `pos`, `level`; índice único sobre `(term_normalized, pos)`.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/nivel-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cefrLevels } from "@/db/schema";

describe("cefr_levels", () => {
  it("guarda una palabra con su categoría y su nivel", async () => {
    const { db, close } = await createTestDb();
    await db.insert(cefrLevels).values({
      termNormalized: "abandon",
      term: "abandon",
      pos: "verb",
      level: "B1",
    });

    const [fila] = await db.select().from(cefrLevels);
    expect(fila.term).toBe("abandon");
    expect(fila.level).toBe("B1");
    await close();
  });

  /**
   * El listado puede dar a la misma palabra un nivel como sustantivo y otro
   * como verbo. Son dos filas.
   */
  it("deja la misma palabra en dos categorías", async () => {
    const { db, close } = await createTestDb();
    await db.insert(cefrLevels).values([
      { termNormalized: "study", term: "study", pos: "noun", level: "A2" },
      { termNormalized: "study", term: "study", pos: "verb", level: "A1" },
    ]);

    expect(await db.select().from(cefrLevels)).toHaveLength(2);
    await close();
  });

  /** El único es lo que hace que recargar el listado actualice en vez de duplicar. */
  it("rechaza la misma palabra y categoría dos veces", async () => {
    const { db, close } = await createTestDb();
    const fila = { termNormalized: "study", term: "study", pos: "noun", level: "A2" };
    await db.insert(cefrLevels).values(fila);

    await expect(db.insert(cefrLevels).values(fila)).rejects.toThrow();
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/nivel-schema.test.ts`
Esperado: FALLA con `"cefrLevels" is not exported by "db/schema.ts"`.

- [ ] **Step 3: Añade la tabla**

Al final de `db/schema.ts`:

```ts
/**
 * El nivel del MCER de una palabra, por categoría gramatical. Se carga una vez
 * desde el CEFR-J Vocabulary Profile y el complemento Octanove para C1/C2, y no
 * se vuelve a escribir.
 *
 * Existe porque sin IA hace falta un criterio para decidir qué palabra de un
 * texto merece la pena aprender, y **la frecuencia no sirve**: en la franja
 * 5.000-20.000 de las más usadas conviven un 39 % de palabras B2 con un 9 % de
 * A2. El nivel sí separa.
 *
 * La categoría se guarda **ya traducida** al vocabulario del proyecto
 * (`adj`, `adv`…), no como la nombra el listado (`adjective`, `adverb`): si se
 * guardara cruda, ninguna palabra casaría con su ficha del diccionario.
 */
export const cefrLevels = pgTable(
  "cefr_levels",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    pos: text("pos").notNull(),
    /** `A1` | `A2` | `B1` | `B2` | `C1` | `C2`. */
    level: text("level").notNull(),
  },
  (table) => ({
    terminoPosIdx: uniqueIndex("cefr_levels_term_pos_idx").on(
      table.termNormalized,
      table.pos,
    ),
  }),
);
```

`serial`, `text` y `uniqueIndex` ya están importados arriba; no toques los imports.

- [ ] **Step 4: Genera la migración**

Ejecuta: `npx drizzle-kit generate`
Esperado: crea `drizzle/0007_<nombre>.sql` con un `CREATE TABLE "cefr_levels"` y un `CREATE UNIQUE INDEX`.

No debe preguntarte nada: una tabla nueva no tiene ambigüedad de renombrado. **Si te pregunta algo, para y reporta BLOCKED** con la pregunta literal.

Abre el `.sql` y comprueba que solo crea esa tabla y su índice, sin tocar ninguna otra.

- [ ] **Step 5: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/nivel-schema.test.ts`
Esperado: PASA, 3 pruebas. PGlite aplica las migraciones de `./drizzle`, así que la tabla existe porque el paso 4 generó el fichero.

- [ ] **Step 6: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add db/schema.ts drizzle/ tests/db/nivel-schema.test.ts
git commit -m "Añadir la tabla de niveles del MCER"
```

---

### Task 2: Leer el listado del MCER

**Files:**
- Create: `lib/nivel/mcer.ts`
- Test: `tests/nivel/mcer.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` de `@/lib/normalize`.
- Produces:
  - `export const NIVELES = ["A1","A2","B1","B2","C1","C2"] as const`
  - `export type Nivel = (typeof NIVELES)[number]`
  - `export function esNivel(valor: unknown): valor is Nivel`
  - `export function alcanzaElSuelo(nivel: Nivel, suelo: Nivel): boolean`
  - `export function categoriaDelProyecto(pos: string): string | null`
  - `export type FilaNivel = { termNormalized: string; term: string; pos: string; level: Nivel }`
  - `export function filasDeLineaMcer(linea: string): FilaNivel[]`

**El formato del CSV.** Cabecera `headword,pos,CEFR,...`. Solo importan las **tres primeras columnas**. Las siguientes traen comas dentro de comillas (699 líneas del fichero A1-B2), pero **ningún headword lleva coma** —comprobado sobre los dos ficheros—, así que cortar por comas y quedarse con los tres primeros trozos es seguro. No metas un analizador de CSV: no hace falta.

**Las variantes con barra.** 213 headwords traen varias grafías: `airplane/aeroplane`, `adviser/advisor`, `a.m./A.M./am/AM`. **Cada una es su propia fila**, o `airplane` se quedaría sin nivel. Después de normalizar pueden quedar repetidas (`am` y `AM`); se quitan.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/nivel/mcer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  alcanzaElSuelo,
  categoriaDelProyecto,
  esNivel,
  filasDeLineaMcer,
} from "@/lib/nivel/mcer";

describe("esNivel", () => {
  it("acepta los seis del MCER y nada más", () => {
    expect(esNivel("B2")).toBe(true);
    expect(esNivel("A1")).toBe(true);
    expect(esNivel("D1")).toBe(false);
    expect(esNivel("b2")).toBe(false);
    expect(esNivel(2)).toBe(false);
    expect(esNivel(undefined)).toBe(false);
  });
});

describe("alcanzaElSuelo", () => {
  it("deja pasar lo que está en el suelo o por encima", () => {
    expect(alcanzaElSuelo("B2", "B2")).toBe(true);
    expect(alcanzaElSuelo("C1", "B2")).toBe(true);
    expect(alcanzaElSuelo("C2", "A1")).toBe(true);
  });

  it("corta lo que está por debajo", () => {
    expect(alcanzaElSuelo("B1", "B2")).toBe(false);
    expect(alcanzaElSuelo("A1", "A2")).toBe(false);
  });
});

describe("categoriaDelProyecto", () => {
  /**
   * El listado y el diccionario nombran distinto lo mismo. Sin traducir, ninguna
   * palabra casaría con su ficha y el filtro se quedaría sin nada que filtrar.
   */
  it("traduce las cuatro categorías que son el 97 % del listado", () => {
    expect(categoriaDelProyecto("noun")).toBe("noun");
    expect(categoriaDelProyecto("adjective")).toBe("adj");
    expect(categoriaDelProyecto("verb")).toBe("verb");
    expect(categoriaDelProyecto("adverb")).toBe("adv");
  });

  it("traduce también la cola", () => {
    expect(categoriaDelProyecto("pronoun")).toBe("pron");
    expect(categoriaDelProyecto("preposition")).toBe("prep");
    expect(categoriaDelProyecto("determiner")).toBe("det");
    expect(categoriaDelProyecto("conjunction")).toBe("conj");
    expect(categoriaDelProyecto("number")).toBe("num");
    expect(categoriaDelProyecto("interjection")).toBe("intj");
  });

  /** Las cinco variantes verbales del listado son verbos a efectos del diccionario. */
  it("mete las variantes verbales en `verb`", () => {
    for (const p of ["modal auxiliary", "be-verb", "do-verb", "have-verb", "infinitive-to"]) {
      expect(categoriaDelProyecto(p)).toBe("verb");
    }
  });

  /**
   * El volcado trae dos filas malas: una con la categoría vacía y otra que dice
   * `vern`, errata evidente de `verb`. Se tratan a propósito, no por accidente.
   */
  it("trata `vern` como verbo y descarta la categoría vacía", () => {
    expect(categoriaDelProyecto("vern")).toBe("verb");
    expect(categoriaDelProyecto("")).toBeNull();
    expect(categoriaDelProyecto("   ")).toBeNull();
  });

  it("descarta una categoría que no conoce, en vez de inventarse una", () => {
    expect(categoriaDelProyecto("gerundio")).toBeNull();
  });
});

describe("filasDeLineaMcer", () => {
  it("saca palabra, categoría traducida y nivel", () => {
    expect(filasDeLineaMcer("abandon,verb,B1,,,")).toEqual([
      { termNormalized: "abandon", term: "abandon", pos: "verb", level: "B1" },
    ]);
  });

  /**
   * Las columnas cuarta y siguientes traen comas dentro de comillas. Como ningún
   * headword lleva coma, quedarse con los tres primeros trozos es seguro.
   */
  it("no se despista con las comas de las columnas de más allá", () => {
    const linea = 'accident,noun,A2,"News, lifestyles and current affairs",,Health';
    expect(filasDeLineaMcer(linea)).toEqual([
      { termNormalized: "accident", term: "accident", pos: "noun", level: "A2" },
    ]);
  });

  /**
   * 213 entradas traen varias grafías. Sin desdoblarlas, `airplane` se quedaría
   * sin nivel y no saldría nunca como candidata.
   */
  it("desdobla las variantes separadas por barra", () => {
    expect(filasDeLineaMcer("airplane/aeroplane,noun,A2,,,")).toEqual([
      { termNormalized: "airplane", term: "airplane", pos: "noun", level: "A2" },
      { termNormalized: "aeroplane", term: "aeroplane", pos: "noun", level: "A2" },
    ]);
  });

  it("no repite variantes que normalizan igual", () => {
    const filas = filasDeLineaMcer("a.m./A.M./am/AM,adverb,A1,,,");
    expect(filas.map((f) => f.termNormalized)).toEqual(["a.m.", "am"]);
  });

  it("salta la cabecera y las líneas que no sirven", () => {
    expect(filasDeLineaMcer("headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold")).toEqual([]);
    expect(filasDeLineaMcer("")).toEqual([]);
    expect(filasDeLineaMcer("abandon,verb")).toEqual([]);
    expect(filasDeLineaMcer("abandon,gerundio,B1")).toEqual([]);
    expect(filasDeLineaMcer("abandon,verb,D1")).toEqual([]);
    expect(filasDeLineaMcer(",verb,B1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/nivel/mcer.test.ts`
Esperado: FALLA con `Failed to resolve import "@/lib/nivel/mcer"`.

- [ ] **Step 3: Escribe el módulo**

Crea `lib/nivel/mcer.ts`:

```ts
import { normalizeTerm } from "@/lib/normalize";

/** Los seis niveles del MCER, de menos a más. El orden **es** la escala. */
export const NIVELES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type Nivel = (typeof NIVELES)[number];

export function esNivel(valor: unknown): valor is Nivel {
  return typeof valor === "string" && (NIVELES as readonly string[]).includes(valor);
}

/** Si una palabra de este nivel entra cuando el suelo del filtro es `suelo`. */
export function alcanzaElSuelo(nivel: Nivel, suelo: Nivel): boolean {
  return NIVELES.indexOf(nivel) >= NIVELES.indexOf(suelo);
}

/**
 * El listado del MCER y el diccionario del proyecto nombran distinto la misma
 * categoría gramatical: `adjective` frente a `adj`. **Guardar la cruda dejaría
 * a cada palabra sin poder casar con su ficha del diccionario**, que es
 * justamente lo que el filtro necesita cruzar.
 *
 * Devuelve `null` cuando no sabe traducirla: es mejor perder una fila que
 * inventarse una categoría que el diccionario no usa.
 */
const CATEGORIAS = new Map<string, string>([
  ["noun", "noun"],
  ["adjective", "adj"],
  ["verb", "verb"],
  ["adverb", "adv"],
  ["pronoun", "pron"],
  ["preposition", "prep"],
  ["determiner", "det"],
  ["conjunction", "conj"],
  ["number", "num"],
  ["interjection", "intj"],
  // Las cinco variantes verbales del listado son, para el diccionario, verbos.
  ["modal auxiliary", "verb"],
  ["be-verb", "verb"],
  ["do-verb", "verb"],
  ["have-verb", "verb"],
  ["infinitive-to", "verb"],
  // El volcado trae una única fila que dice `vern`: errata clara de `verb`. Se
  // trata a propósito para que nadie la "arregle" mal dentro de seis meses.
  ["vern", "verb"],
]);

export function categoriaDelProyecto(pos: string): string | null {
  return CATEGORIAS.get(pos.trim().toLowerCase()) ?? null;
}

export type FilaNivel = {
  termNormalized: string;
  term: string;
  pos: string;
  level: Nivel;
};

/**
 * Una línea del CSV del listado se convierte en una o varias filas.
 *
 * **Varias** porque 213 entradas traen las grafías alternativas separadas por
 * barra (`airplane/aeroplane`); sin desdoblarlas, la mitad de esas palabras se
 * quedaría sin nivel.
 *
 * Solo se leen las **tres primeras columnas**. De la cuarta en adelante hay
 * comas dentro de comillas, pero ningún headword lleva coma —comprobado sobre
 * los dos ficheros—, así que cortar por comas y quedarse con los tres primeros
 * trozos es seguro y no hace falta un analizador de CSV.
 *
 * Devuelve lista vacía ante cualquier línea que no sirva, incluida la cabecera:
 * una línea mala no puede abortar una carga de 9.935.
 */
export function filasDeLineaMcer(linea: string): FilaNivel[] {
  const trozos = linea.split(",");
  if (trozos.length < 3) return [];

  const [crudo, pos, nivel] = trozos;
  const level = nivel.trim().toUpperCase();
  if (!esNivel(level)) return [];

  const categoria = categoriaDelProyecto(pos);
  if (!categoria) return [];

  const filas: FilaNivel[] = [];
  const vistas = new Set<string>();
  for (const variante of crudo.split("/")) {
    const term = variante.trim();
    if (!term) continue;
    const termNormalized = normalizeTerm(term);
    if (!termNormalized || vistas.has(termNormalized)) continue;
    vistas.add(termNormalized);
    filas.push({ termNormalized, term, pos: categoria, level });
  }
  return filas;
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/nivel/mcer.test.ts`
Esperado: PASA, 12 pruebas.

- [ ] **Step 5: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add lib/nivel/mcer.ts tests/nivel/mcer.test.ts
git commit -m "Leer el listado de niveles del MCER"
```

---

### Task 3: Cargar los niveles y consultarlos

**Files:**
- Create: `db/repository/nivel.ts`
- Create: `scripts/cargar-niveles.ts`
- Modify: `package.json` (scripts), `README.md`
- Test: `tests/db/nivel.test.ts`

**Interfaces:**
- Consumes: `filasDeLineaMcer`, `FilaNivel`, `Nivel`, `NIVELES` de `@/lib/nivel/mcer`; `cefrLevels` de `@/db/schema`; `lineasDeFicheroGz` de `@/lib/diccionario/lineas`.
- Produces:
  - `export async function cargarNiveles(db: Database, lineas: AsyncIterable<string>, opciones?: { tamanoLote?: number }): Promise<{ entradas: number }>`
  - `export async function nivelesDe(db: Database, terminos: string[]): Promise<Map<string, Nivel>>` — clave: el término normalizado; valor: **el nivel más bajo** de sus categorías.

**Por qué el más bajo:** el listado puede dar a `study` A2 como sustantivo y A1 como verbo. El nivel de la palabra es aquel en el que el estudiante se la encuentra por primera vez, o sea el menor. Es también el criterio con el que se midieron las cifras de la especificación §5.

**El fichero de entrada** son los dos CSV concatenados, sin comprimir. `lineasDeFicheroGz` solo lee `.gz`, así que el script acepta ficheros llanos leyéndolos con `createReadStream` + `readline` directamente; mira `lib/diccionario/lineas.ts` para copiar el patrón perezoso, que es lo que evitó un cuelgue en la carga del diccionario inglés.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/nivel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { cargarNiveles, nivelesDe } from "@/db/repository/nivel";
import { cefrLevels } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

describe("cargarNiveles", () => {
  it("guarda una fila por palabra y categoría", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("abandon,verb,B1,,,", "abandon,noun,B2,,,", "airplane/aeroplane,noun,A2,,,"),
    );

    expect(resultado).toEqual({ entradas: 4 });
    expect(await db.select().from(cefrLevels)).toHaveLength(4);
    await close();
  });

  it("salta la cabecera y las líneas que no sirven", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold", "", "abandon,verb,B1,,,"),
    );

    expect(resultado).toEqual({ entradas: 1 });
    await close();
  });

  it("recargar no duplica: actualiza", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,"));
    await cargarNiveles(db, lineasDe("abandon,verb,B2,,,"));

    const filas = await db.select().from(cefrLevels);
    expect(filas).toHaveLength(1);
    expect(filas[0].level).toBe("B2");
    await close();
  });

  /**
   * Con lotes pequeños, dos filas de la misma clave pueden caer en el mismo
   * INSERT. Postgres rechaza tocar dos veces la misma fila en un ON CONFLICT, y
   * eso tumbaría la carga entera. Es el fallo que ya mordió en la carga del
   * diccionario español.
   */
  it("dos filas de la misma clave en el mismo lote no revientan la carga", async () => {
    const { db, close } = await createTestDb();
    const resultado = await cargarNiveles(
      db,
      lineasDe("study,noun,A2,,,", "study,noun,B1,,,"),
      { tamanoLote: 10 },
    );

    expect(resultado.entradas).toBe(2);
    expect(await db.select().from(cefrLevels)).toHaveLength(1);
    await close();
  });

  it("escribe por lotes sin perder ninguna entrada", async () => {
    const { db, close } = await createTestDb();
    const muchas = Array.from({ length: 7 }, (_, i) => `palabra${i},noun,B1,,,`);

    const resultado = await cargarNiveles(db, lineasDe(...muchas), { tamanoLote: 2 });

    expect(resultado).toEqual({ entradas: 7 });
    expect(await db.select().from(cefrLevels)).toHaveLength(7);
    await close();
  });
});

describe("nivelesDe", () => {
  it("devuelve el nivel de cada término pedido", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,", "house,noun,A1,,,"));

    const niveles = await nivelesDe(db, ["abandon", "house"]);

    expect(niveles.get("abandon")).toBe("B1");
    expect(niveles.get("house")).toBe("A1");
    await close();
  });

  /**
   * `study` es A1 como verbo y A2 como sustantivo. El nivel de la palabra es
   * aquel en el que el estudiante se la encuentra primero: el más bajo.
   */
  it("con varias categorías se queda con el nivel más bajo", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("study,noun,A2,,,", "study,verb,A1,,,"));

    expect((await nivelesDe(db, ["study"])).get("study")).toBe("A1");
    await close();
  });

  it("lo que no está no aparece en el mapa", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("abandon,verb,B1,,,"));

    const niveles = await nivelesDe(db, ["abandon", "xyzzy"]);

    expect(niveles.has("xyzzy")).toBe(false);
    expect(niveles.size).toBe(1);
    await close();
  });

  it("con la lista vacía no consulta y devuelve un mapa vacío", async () => {
    const { db, close } = await createTestDb();
    expect((await nivelesDe(db, [])).size).toBe(0);
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/nivel.test.ts`
Esperado: FALLA con `Failed to resolve import "@/db/repository/nivel"`.

- [ ] **Step 3: Escribe el repositorio**

Crea `db/repository/nivel.ts`:

```ts
import { inArray, sql } from "drizzle-orm";
import { cefrLevels } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  filasDeLineaMcer,
  NIVELES,
  type FilaNivel,
  type Nivel,
} from "@/lib/nivel/mcer";

/** 500 filas por INSERT: por encima, el número de parámetros incomoda al driver. */
const TAMANO_LOTE = 500;

/**
 * Carga el listado del MCER en `cefr_levels`.
 *
 * Sustituye al chocar, no fusiona: aquí no conviven dos orígenes en la misma
 * tabla, a diferencia de `spanish_meanings`.
 *
 * **Deduplica cada lote antes de escribirlo.** Postgres rechaza un
 * `ON CONFLICT DO UPDATE` que toque dos veces la misma fila en el mismo INSERT,
 * y eso tumbaría la carga entera. El listado trae la misma clave repetida
 * cuando dos grafías de una entrada normalizan igual.
 */
export async function cargarNiveles(
  db: Database,
  lineas: AsyncIterable<string>,
  opciones: { tamanoLote?: number } = {},
): Promise<{ entradas: number }> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  return db.transaction(async (tx) => {
    let entradas = 0;
    let lote: FilaNivel[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      const porClave = new Map<string, FilaNivel>();
      for (const fila of lote) porClave.set(`${fila.termNormalized}\t${fila.pos}`, fila);

      await tx
        .insert(cefrLevels)
        .values([...porClave.values()])
        .onConflictDoUpdate({
          target: [cefrLevels.termNormalized, cefrLevels.pos],
          set: { term: sql`excluded.term`, level: sql`excluded.level` },
        });
      entradas += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const filas = filasDeLineaMcer(linea);
      if (filas.length === 0) continue;
      lote.push(...filas);
      if (lote.length >= tamanoLote) await vaciarLote();
    }
    await vaciarLote();

    return { entradas };
  });
}

/**
 * El nivel de cada término pedido.
 *
 * Cuando una palabra aparece con varias categorías —`study` es A1 como verbo y
 * A2 como sustantivo— se queda **el más bajo**: es el nivel al que el estudiante
 * se topa con esa palabra por primera vez, y por tanto el que decide si ya
 * debería saberla.
 */
export async function nivelesDe(
  db: Database,
  terminos: string[],
): Promise<Map<string, Nivel>> {
  if (terminos.length === 0) return new Map();

  const filas = await db
    .select({ termNormalized: cefrLevels.termNormalized, level: cefrLevels.level })
    .from(cefrLevels)
    .where(inArray(cefrLevels.termNormalized, terminos));

  const niveles = new Map<string, Nivel>();
  for (const fila of filas) {
    const nivel = fila.level as Nivel;
    const previo = niveles.get(fila.termNormalized);
    if (!previo || NIVELES.indexOf(nivel) < NIVELES.indexOf(previo)) {
      niveles.set(fila.termNormalized, nivel);
    }
  }
  return niveles;
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/nivel.test.ts`
Esperado: PASA, 9 pruebas.

- [ ] **Step 5: Escribe el script de carga**

Crea `scripts/cargar-niveles.ts`:

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { cargarNiveles } from "@/db/repository/nivel";
import { getDb } from "@/db/client";

/**
 * Lee un fichero de texto línea a línea, y **perezosamente**: el cuerpo de un
 * generador no corre hasta la primera vuelta, así que el fichero no se abre
 * hasta que el cargador está listo para consumirlo. Es la misma precaución que
 * `lib/diccionario/lineas.ts`, escrita allí después de que una carga se colgara
 * cinco minutos por leer el fichero antes de tiempo.
 */
async function* lineasDeFichero(ruta: string): AsyncGenerator<string> {
  const lineas = createInterface({ input: createReadStream(ruta), crlfDelay: Infinity });
  for await (const linea of lineas) yield linea;
}

/**
 * Carga el listado de niveles del MCER en la base apuntada por DATABASE_URL.
 *
 *   DATABASE_URL='...' npx tsx scripts/cargar-niveles.ts ~/Vocably-diccionario/cefr.csv
 *
 * El fichero son los dos CSV del proyecto Open Language Profiles concatenados;
 * el README explica cómo obtenerlos. Se ejecuta a mano, una vez.
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Falta la ruta del CSV con los niveles.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const inicio = Date.now();
  const { entradas } = await cargarNiveles(getDb(), lineasDeFichero(ruta));
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Cargadas ${entradas} entradas en ${segundos} s.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

En `package.json`, junto a `cargar:espanol`:

```json
"cargar:niveles": "tsx scripts/cargar-niveles.ts"
```

- [ ] **Step 6: Documenta la carga y la atribución**

En `README.md`, después de la sección del diccionario español:

```markdown
### Los niveles del MCER

El nivel de cada palabra sale del **CEFR-J Vocabulary Profile 1.5**, compilado por
Yukio Tono (Tokyo University of Foreign Studies), más el **Octanove Vocabulary
Profile C1/C2 1.0** de Octanove Labs, publicados juntos en
[Open Language Profiles](https://github.com/openlanguageprofiles/olp-en-cefrj).

El CEFR-J se puede usar con fines comerciales y no comerciales sin coste,
citándolo; el copyright es de Tono Laboratory. El complemento Octanove está bajo
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Se obtienen y se cargan así:

```bash
cd ~/Vocably-diccionario
curl -sO https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv
curl -sO https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv
cat cefrj-vocabulary-profile-1.5.csv octanove-vocabulary-profile-c1c2-1.0.csv > cefr.csv

DATABASE_URL='...' npm run cargar:niveles -- ~/Vocably-diccionario/cefr.csv
```

Son unas 9.900 entradas. Es idempotente: recargarlo actualiza en vez de duplicar.
```

- [ ] **Step 7: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add db/repository/nivel.ts scripts/cargar-niveles.ts package.json README.md tests/db/nivel.test.ts
git commit -m "Cargar y consultar los niveles del MCER"
```

---

### Task 4: Partir el texto en candidatas

**Files:**
- Create: `lib/extraer/candidatas.ts`
- Test: `tests/extraer/candidatas.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export type Candidata = { texto: string; frase: string }`
  - `export const MAXIMO_PALABRAS = 3`
  - `export function candidatasDeTexto(texto: string): Candidata[]`

**Qué hace y por qué así.** Parte el texto en frases, y de cada frase saca las palabras sueltas y los **grupos contiguos de dos y tres palabras**. Los grupos son lo que encuentra verbos frasales y expresiones: **no se analiza la gramática, se consulta el diccionario**, que ya sabe cuáles existen (20.012 verbos frasales). Cada candidata lleva **la frase en que apareció**, que es el contexto que acaba en la tarjeta.

Los grupos **no cruzan el final de una frase**: «He arrived. Then left» no debe producir «arrived then».

Cada texto distinto aparece **una sola vez**, con la frase de su primera aparición.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/extraer/candidatas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { candidatasDeTexto } from "@/lib/extraer/candidatas";

const textos = (frase: string) => candidatasDeTexto(frase).map((c) => c.texto);

describe("candidatasDeTexto", () => {
  it("saca las palabras sueltas en minúscula", () => {
    expect(textos("The Dog barked")).toEqual(
      expect.arrayContaining(["the", "dog", "barked"]),
    );
  });

  /**
   * Los grupos son lo que encuentra los verbos frasales. No se analiza la
   * gramática: se le pregunta al diccionario, que ya sabe cuáles existen.
   */
  it("saca grupos de dos y de tres palabras", () => {
    const salida = textos("She gave up quickly");
    expect(salida).toContain("gave up");
    expect(salida).toContain("gave up quickly");
    expect(salida).toContain("she gave up");
  });

  it("no saca grupos de cuatro", () => {
    for (const c of candidatasDeTexto("one two three four")) {
      expect(c.texto.split(" ").length).toBeLessThanOrEqual(3);
    }
  });

  /**
   * Un grupo que cruza el punto une palabras que nunca estuvieron juntas y
   * podría inventarse un verbo frasal que el texto no contiene.
   */
  it("los grupos no cruzan el final de una frase", () => {
    const salida = textos("He arrived. Then left.");
    expect(salida).toContain("he arrived");
    expect(salida).not.toContain("arrived then");
  });

  it("cada candidata trae la frase en que apareció", () => {
    const salida = candidatasDeTexto("The dog barked. The cat slept.");
    expect(salida.find((c) => c.texto === "cat")?.frase).toBe("The cat slept.");
    expect(salida.find((c) => c.texto === "dog")?.frase).toBe("The dog barked.");
  });

  it("una palabra repetida sale una vez, con la frase de la primera", () => {
    const salida = candidatasDeTexto("The dog barked. The dog slept.");
    const perros = salida.filter((c) => c.texto === "dog");
    expect(perros).toHaveLength(1);
    expect(perros[0].frase).toBe("The dog barked.");
  });

  it("conserva apóstrofos y guiones, que son parte de la palabra", () => {
    const salida = textos("It's a well-known problem");
    expect(salida).toContain("it's");
    expect(salida).toContain("well-known");
  });

  it("deja fuera los números y la puntuación suelta", () => {
    const salida = textos("He paid 42 dollars -- twice!");
    expect(salida).not.toContain("42");
    expect(salida).not.toContain("--");
    expect(salida).toContain("dollars");
  });

  it("con un texto vacío o sin letras devuelve lista vacía", () => {
    expect(candidatasDeTexto("")).toEqual([]);
    expect(candidatasDeTexto("   \n  ")).toEqual([]);
    expect(candidatasDeTexto("123 456 !!!")).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/extraer/candidatas.test.ts`
Esperado: FALLA con `Failed to resolve import "@/lib/extraer/candidatas"`.

- [ ] **Step 3: Escribe el módulo**

Crea `lib/extraer/candidatas.ts`:

```ts
/** Cuántas palabras seguidas como mucho forma una candidata. */
export const MAXIMO_PALABRAS = 3;

export type Candidata = {
  /** El texto normalizado con el que se consultará el diccionario. */
  texto: string;
  /** La frase del libro en que apareció. Es el contexto de la tarjeta. */
  frase: string;
};

/** Corta por punto, interrogación y exclamación, conservando el signo. */
const FIN_DE_FRASE = /[^.!?]+[.!?]*/g;
/** Una palabra: letras, con apóstrofos y guiones dentro. Los números fuera. */
const PALABRA = /[a-zA-Z][a-zA-Z'’-]*/g;

/**
 * Parte un texto en candidatas: cada palabra suelta y cada grupo contiguo de
 * dos y tres palabras, con la frase en que aparecieron.
 *
 * **Los grupos son lo que encuentra los verbos frasales y las expresiones.** No
 * se analiza la gramática —frágil y cara— sino que se le pregunta después al
 * diccionario, que ya sabe cuáles existen de verdad: trae 20.012 verbos
 * frasales. El precio es que «gave it up», con la partícula separada, no se
 * reconoce; está aceptado en la especificación §10.
 *
 * Los grupos **no cruzan el final de una frase**: unir «arrived» con «then» a
 * través de un punto podría inventarse un verbo frasal que el texto no tiene.
 *
 * Cada texto distinto sale **una sola vez**, con la frase de su primera
 * aparición: es la que el usuario verá, y repetirla no añade nada.
 */
export function candidatasDeTexto(texto: string): Candidata[] {
  const candidatas: Candidata[] = [];
  const vistas = new Set<string>();

  for (const bruta of texto.match(FIN_DE_FRASE) ?? []) {
    const frase = bruta.trim();
    if (!frase) continue;

    const palabras = (frase.match(PALABRA) ?? []).map((p) => p.toLowerCase());

    for (let inicio = 0; inicio < palabras.length; inicio += 1) {
      for (let largo = 1; largo <= MAXIMO_PALABRAS; largo += 1) {
        if (inicio + largo > palabras.length) break;
        const texto = palabras.slice(inicio, inicio + largo).join(" ");
        if (vistas.has(texto)) continue;
        vistas.add(texto);
        candidatas.push({ texto, frase });
      }
    }
  }

  return candidatas;
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/extraer/candidatas.test.ts`
Esperado: PASA, 9 pruebas.

- [ ] **Step 5: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add lib/extraer/candidatas.ts tests/extraer/candidatas.test.ts
git commit -m "Partir el texto de un PDF en candidatas con su frase"
```

---

### Task 5: La consulta y el filtro

**Files:**
- Create: `db/repository/extraer.ts`
- Test: `tests/db/extraer.test.ts`

**Interfaces:**
- Consumes: `Candidata` de `@/lib/extraer/candidatas`; `Nivel`, `alcanzaElSuelo` de `@/lib/nivel/mcer`; `nivelesDe` de `@/db/repository/nivel`; `tipoDeTermino` de `@/lib/diccionario/tipo`; `dictionaryEntries`, `spanishMeanings`, `terms` de `@/db/schema`.
- Produces:
  - ```ts
    export type Sugerencia = {
      term: string;          // el término tal como lo trae el diccionario
      pos: string;
      gloss: string;         // el significado en inglés de la primera acepción
      example: string | null;
      frase: string;         // la frase del libro
      significados: string[]; // el español de la palabra, hasta cinco
      nivel: Nivel | null;   // null = no medido
      tipo: "word" | "phrasal_verb" | "expression";
    };
    ```
  - `export async function buscarSugerencias(db: Database, candidatas: Candidata[], suelo: Nivel): Promise<Sugerencia[]>`

**El filtro, de la especificación §7.2:**

1. Lo que **no está en el diccionario inglés**, fuera: no hay nada que enseñar.
2. Lo que **ya está en la biblioteca**, fuera.
3. **Palabras sueltas**: entran si su nivel alcanza el suelo. **Sin nivel, fuera** — son nombres propios y rarezas.
4. **Verbos frasales y expresiones**: entran **siempre**, tengan nivel o no. El listado del MCER no trae ninguno, y son buena parte de lo que la aplicación existe para aprender.

**Se queda la primera acepción** de cada término (la de menor `id`, que es el sentido principal de Wikcionario). Ver «Decisiones que la especificación no fijó», nº 1.

**No se llama a MyMemory.** Traducir cientos de candidatas se comería la cuota diaria en una extracción.

**El orden**, de la especificación §8: primero los verbos frasales y las expresiones, en el orden en que aparecen en el texto; después las palabras sueltas de más difícil a más fácil.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/extraer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { buscarSugerencias } from "@/db/repository/extraer";
import { cargarNiveles } from "@/db/repository/nivel";
import { anadirDesdeDiccionario } from "@/db/repository/diccionario";
import { dictionaryEntries, spanishMeanings } from "@/db/schema";

async function* lineasDe(...textos: string[]) {
  for (const t of textos) yield t;
}

/** Deja una base con tres palabras: dos sueltas de distinto nivel y un frasal. */
async function baseConDiccionario(db: Parameters<typeof buscarSugerencias>[0]) {
  await db.insert(dictionaryEntries).values([
    { termNormalized: "abandon", term: "abandon", pos: "verb", gloss: "To leave behind.", example: null },
    { termNormalized: "house", term: "house", pos: "noun", gloss: "A building.", example: null },
    { termNormalized: "give up", term: "give up", pos: "verb", gloss: "To stop trying.", example: null },
  ]);
  await cargarNiveles(db, lineasDe("abandon,verb,B2,,,", "house,noun,A1,,,"));
}

const candidata = (texto: string) => ({ texto, frase: `Frase con ${texto}.` });

describe("buscarSugerencias", () => {
  it("deja pasar una palabra que alcanza el suelo", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s).toHaveLength(1);
    expect(s[0].term).toBe("abandon");
    expect(s[0].nivel).toBe("B2");
    expect(s[0].tipo).toBe("word");
    expect(s[0].frase).toBe("Frase con abandon.");
    await close();
  });

  it("corta una palabra por debajo del suelo", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    expect(await buscarSugerencias(db, [candidata("house")], "B2")).toEqual([]);
    await close();
  });

  /**
   * Es la razón de ser de la decisión 2 del usuario: el listado del MCER no
   * trae ni un verbo frasal, así que filtrar solo por nivel los borraría todos.
   */
  it("deja pasar un verbo frasal aunque no tenga nivel", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("give up")], "C2");

    expect(s).toHaveLength(1);
    expect(s[0].term).toBe("give up");
    expect(s[0].nivel).toBeNull();
    expect(s[0].tipo).toBe("phrasal_verb");
    await close();
  });

  it("corta una palabra suelta sin nivel: es nombre propio o rareza", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(dictionaryEntries).values({
      termNormalized: "sherlock", term: "Sherlock", pos: "noun", gloss: "A detective.", example: null,
    });

    expect(await buscarSugerencias(db, [candidata("sherlock")], "A1")).toEqual([]);
    await close();
  });

  it("lo que no está en el diccionario no llega a la lista", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    expect(await buscarSugerencias(db, [candidata("xyzzy")], "A1")).toEqual([]);
    await close();
  });

  it("lo que ya está en la biblioteca no se vuelve a ofrecer", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await anadirDesdeDiccionario(db, {
      term: "abandon", pos: "verb", gloss: "To leave behind.",
      example: null, translation: "abandonar", level: "B2",
    });

    expect(await buscarSugerencias(db, [candidata("abandon")], "B2")).toEqual([]);
    await close();
  });

  it("trae los significados en español de la palabra", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(spanishMeanings).values({
      termNormalized: "abandon", term: "abandon", pos: "verb",
      meanings: ["Abandonar.", "Dejar."], source: "wikcionario-es",
    });

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s[0].significados).toEqual(["Abandonar.", "Dejar."]);
    await close();
  });

  it("una palabra sin español se ofrece igual, con la lista vacía", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);

    const s = await buscarSugerencias(db, [candidata("abandon")], "B2");

    expect(s).toHaveLength(1);
    expect(s[0].significados).toEqual([]);
    await close();
  });

  /**
   * `bank` tiene siete acepciones. Ofrecer las siete convertiría una extracción
   * de cuarenta palabras en una de trescientas.
   */
  it("de una palabra con varias acepciones ofrece una sola, la primera", async () => {
    const { db, close } = await createTestDb();
    await cargarNiveles(db, lineasDe("bank,noun,B1,,,"));
    await db.insert(dictionaryEntries).values([
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "A financial institution.", example: null },
      { termNormalized: "bank", term: "bank", pos: "noun", gloss: "An edge of a river.", example: null },
    ]);

    const s = await buscarSugerencias(db, [candidata("bank")], "B1");

    expect(s).toHaveLength(1);
    expect(s[0].gloss).toBe("A financial institution.");
    await close();
  });

  it("ordena los frasales primero y las sueltas de más difícil a más fácil", async () => {
    const { db, close } = await createTestDb();
    await baseConDiccionario(db);
    await db.insert(dictionaryEntries).values({
      termNormalized: "ubiquitous", term: "ubiquitous", pos: "adj", gloss: "Everywhere.", example: null,
    });
    await cargarNiveles(db, lineasDe("ubiquitous,adjective,C2,,,"));

    const s = await buscarSugerencias(
      db,
      [candidata("abandon"), candidata("ubiquitous"), candidata("give up")],
      "B1",
    );

    expect(s.map((x) => x.term)).toEqual(["give up", "ubiquitous", "abandon"]);
    await close();
  });

  it("con la lista de candidatas vacía devuelve lista vacía", async () => {
    const { db, close } = await createTestDb();
    expect(await buscarSugerencias(db, [], "B1")).toEqual([]);
    await close();
  });
});
```

**Sobre «que no se llama al traductor» (especificación §9):** no hay nada que
espiar, y eso es lo mejor que podía pasar. `buscarSugerencias` **no recibe ningún
traductor ni importa `lib/diccionario/traductor`**, así que llamarlo es
imposible por construcción, no por disciplina. La prueba «una palabra sin español
se ofrece igual, con la lista vacía» es su cara observable: con una llamada al
traductor de por medio, esa lista no vendría vacía. Si al revisar ves un import
del traductor en este fichero, **eso sí es un hallazgo**.
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/extraer.test.ts`
Esperado: FALLA con `Failed to resolve import "@/db/repository/extraer"`.

- [ ] **Step 3: Escribe la consulta**

Crea `db/repository/extraer.ts`:

```ts
import { inArray } from "drizzle-orm";
import { dictionaryEntries, spanishMeanings, terms } from "@/db/schema";
import type { Database } from "@/db/types";
import type { Candidata } from "@/lib/extraer/candidatas";
import { tipoDeTermino } from "@/lib/diccionario/tipo";
import { MAXIMO_SIGNIFICADOS_MOSTRADOS } from "@/lib/diccionario/espanol";
import { alcanzaElSuelo, NIVELES, type Nivel } from "@/lib/nivel/mcer";
import { nivelesDe } from "@/db/repository/nivel";

export type Sugerencia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  frase: string;
  significados: string[];
  /** `null` cuando el listado del MCER no la cubre: verbos frasales y rarezas. */
  nivel: Nivel | null;
  tipo: "word" | "phrasal_verb" | "expression";
};

/**
 * Las candidatas de un texto que merece la pena ofrecer, con todo lo que la
 * pantalla necesita para enseñarlas.
 *
 * El filtro, que es la razón de ser de esta función:
 *
 * - **Palabras sueltas**: entran si su nivel alcanza el suelo. **Sin nivel,
 *   fuera**: son nombres propios y rarezas que el listado no cubre.
 * - **Verbos frasales y expresiones**: entran **siempre**. El listado del MCER
 *   no trae ni uno solo, así que filtrarlos por nivel los borraría todos — y
 *   son buena parte de lo que esta aplicación existe para aprender.
 *
 * **No se llama a MyMemory.** Traducir cientos de candidatas de golpe se comería
 * su cuota diaria de 5.000 caracteres en una sola extracción. Una candidata sin
 * español se ofrece igual; la pantalla del diccionario está para afinarla.
 */
export async function buscarSugerencias(
  db: Database,
  candidatas: Candidata[],
  suelo: Nivel,
): Promise<Sugerencia[]> {
  if (candidatas.length === 0) return [];

  const orden = new Map(candidatas.map((c, i) => [c.texto, i]));
  const frases = new Map(candidatas.map((c) => [c.texto, c.frase]));
  const textos = [...orden.keys()];

  const [acepciones, guardados, espanol, niveles] = await Promise.all([
    db
      .select({
        id: dictionaryEntries.id,
        termNormalized: dictionaryEntries.termNormalized,
        term: dictionaryEntries.term,
        pos: dictionaryEntries.pos,
        gloss: dictionaryEntries.gloss,
        example: dictionaryEntries.example,
      })
      .from(dictionaryEntries)
      .where(inArray(dictionaryEntries.termNormalized, textos))
      .orderBy(dictionaryEntries.id),
    db
      .select({ termNormalized: terms.termNormalized })
      .from(terms)
      .where(inArray(terms.termNormalized, textos)),
    db
      .select({
        termNormalized: spanishMeanings.termNormalized,
        pos: spanishMeanings.pos,
        meanings: spanishMeanings.meanings,
      })
      .from(spanishMeanings)
      .where(inArray(spanishMeanings.termNormalized, textos)),
    nivelesDe(db, textos),
  ]);

  const enBiblioteca = new Set(guardados.map((g) => g.termNormalized));

  // La primera acepción de cada término: `orderBy(id)` deja delante el sentido
  // principal de Wikcionario. Ofrecer las siete de `bank` convertiría una
  // extracción de cuarenta palabras en una de trescientas.
  const primera = new Map<string, (typeof acepciones)[number]>();
  for (const a of acepciones) {
    if (!primera.has(a.termNormalized)) primera.set(a.termNormalized, a);
  }

  const significadosDe = (termNormalized: string, pos: string): string[] => {
    const suyo = espanol.find((e) => e.termNormalized === termNormalized && e.pos === pos);
    const general = espanol.find((e) => e.termNormalized === termNormalized && e.pos === "");
    return (suyo ?? general)?.meanings.slice(0, MAXIMO_SIGNIFICADOS_MOSTRADOS) ?? [];
  };

  // El puesto en el texto viaja con cada sugerencia y no se recalcula al
  // ordenar: `acepcion.term` es como lo escribe el diccionario y no tiene por
  // qué coincidir con la clave normalizada con la que se buscó.
  const conOrden: Array<{ sugerencia: Sugerencia; puesto: number }> = [];
  for (const [termNormalized, acepcion] of primera) {
    if (enBiblioteca.has(termNormalized)) continue;

    const tipo = tipoDeTermino(acepcion.term, acepcion.pos);
    const nivel = niveles.get(termNormalized) ?? null;

    // Las de una sola palabra necesitan nivel y necesitan alcanzar el suelo.
    // Las de varias entran siempre: ver el comentario de arriba.
    if (tipo === "word" && (!nivel || !alcanzaElSuelo(nivel, suelo))) continue;

    conOrden.push({
      sugerencia: {
        term: acepcion.term,
        pos: acepcion.pos,
        gloss: acepcion.gloss,
        example: acepcion.example,
        frase: frases.get(termNormalized) ?? "",
        significados: significadosDe(termNormalized, acepcion.pos),
        nivel,
        tipo,
      },
      puesto: orden.get(termNormalized) ?? 0,
    });
  }

  // Primero lo que no tiene nivel medido —los frasales y las expresiones—, en el
  // orden del texto; después las sueltas, de más difícil a más fácil.
  conOrden.sort((a, b) => {
    const aEsSuelta = a.sugerencia.tipo === "word";
    const bEsSuelta = b.sugerencia.tipo === "word";
    if (aEsSuelta !== bEsSuelta) return aEsSuelta ? 1 : -1;
    if (!aEsSuelta) return a.puesto - b.puesto;
    return (
      NIVELES.indexOf(b.sugerencia.nivel as Nivel) -
      NIVELES.indexOf(a.sugerencia.nivel as Nivel)
    );
  });

  return conOrden.map((c) => c.sugerencia);
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/extraer.test.ts`
Esperado: PASA, 11 pruebas.

- [ ] **Step 5: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add db/repository/extraer.ts tests/db/extraer.test.ts
git commit -m "Filtrar las candidatas por nivel, dejando pasar siempre los frasales"
```

---

### Task 6: La ruta

**Files:**
- Create: `app/api/extraer-sin-ia/route.ts`
- Test: `tests/api/extraer-sin-ia.test.ts`

**Interfaces:**
- Consumes: `buscarSugerencias`, `Sugerencia` de `@/db/repository/extraer`; `esNivel`, `Nivel` de `@/lib/nivel/mcer`; `getDb` de `@/db/client`.
- Produces: `POST /api/extraer-sin-ia`, cuerpo `{ candidatas: Candidata[]; suelo: string }`, respuesta `{ sugerencias: Sugerencia[] }`.

**El fichero de pruebas usa `vi.mock`, no PGlite**, como `tests/api/diccionario.test.ts`. Míralo antes de escribir para copiar el patrón.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/api/extraer-sin-ia.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { valor: null as unknown };
vi.mock("@/db/client", () => ({ getDb: () => db.valor }));

const buscarSugerencias = vi.fn();
vi.mock("@/db/repository/extraer", () => ({
  buscarSugerencias: (...args: unknown[]) => buscarSugerencias(...args),
}));

const { POST } = await import("@/app/api/extraer-sin-ia/route");

beforeEach(() => {
  buscarSugerencias.mockReset();
  buscarSugerencias.mockResolvedValue([]);
});

const pide = (cuerpo: unknown) =>
  POST(
    new Request("http://localhost/api/extraer-sin-ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
  );

const candidata = { texto: "abandon", frase: "He abandoned it." };

describe("POST /api/extraer-sin-ia", () => {
  it("devuelve las sugerencias que da el repositorio", async () => {
    buscarSugerencias.mockResolvedValue([
      { term: "abandon", pos: "verb", gloss: "To leave.", example: null,
        frase: "He abandoned it.", significados: ["Abandonar."], nivel: "B2", tipo: "word" },
    ]);

    const cuerpo = await (await pide({ candidatas: [candidata], suelo: "B2" })).json();

    expect(cuerpo.sugerencias).toHaveLength(1);
    expect(cuerpo.sugerencias[0].term).toBe("abandon");
  });

  it("le pasa al repositorio el suelo que se le pide", async () => {
    await pide({ candidatas: [candidata], suelo: "C1" });
    expect(buscarSugerencias.mock.calls[0][2]).toBe("C1");
  });

  it("sin candidatas responde 400 sin consultar nada", async () => {
    const res = await pide({ candidatas: [], suelo: "B2" });
    expect(res.status).toBe(400);
    expect(buscarSugerencias).not.toHaveBeenCalled();
  });

  it("con un suelo que no es un nivel responde 400", async () => {
    const res = await pide({ candidatas: [candidata], suelo: "Z9" });
    expect(res.status).toBe(400);
    expect(buscarSugerencias).not.toHaveBeenCalled();
  });

  it("con un cuerpo que no es JSON responde 400 y no revienta", async () => {
    const res = await POST(
      new Request("http://localhost/api/extraer-sin-ia", { method: "POST", body: "{roto" }),
    );
    expect(res.status).toBe(400);
  });

  it("descarta las candidatas mal formadas en vez de tumbar la petición", async () => {
    await pide({ candidatas: [candidata, { texto: 42 }, null, { frase: "sin texto" }], suelo: "B2" });
    expect(buscarSugerencias.mock.calls[0][1]).toEqual([candidata]);
  });

  /**
   * Si la consulta falla —porque nadie cargó los niveles, por ejemplo— la ruta
   * no puede dejar que la excepción suba: Next devolvería un 500 con cuerpo
   * HTML y el navegador reventaría al leerlo como JSON.
   */
  it("si la base falla responde 500 con un JSON que lo explica", async () => {
    buscarSugerencias.mockRejectedValue(new Error('relation "cefr_levels" does not exist'));

    const res = await pide({ candidatas: [candidata], suelo: "B2" });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).error).toMatch(/niveles|migraciones/i);
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/api/extraer-sin-ia.test.ts`
Esperado: FALLA con `Failed to resolve import "@/app/api/extraer-sin-ia/route"`.

- [ ] **Step 3: Escribe la ruta**

Crea `app/api/extraer-sin-ia/route.ts`:

```ts
import { NextResponse } from "next/server";
import { buscarSugerencias } from "@/db/repository/extraer";
import { esNivel } from "@/lib/nivel/mcer";
import type { Candidata } from "@/lib/extraer/candidatas";
import { getDb } from "@/db/client";

/**
 * Las candidatas de un texto que merece la pena ofrecer.
 *
 * **No llama a Claude ni a ningún servicio de pago**, y tampoco al traductor
 * gratuito: traducir cientos de candidatas se comería su cuota diaria en una
 * sola extracción. Todo lo que devuelve sale de la base.
 *
 * El PDF **no llega hasta aquí**: lo lee el navegador y manda solo las cadenas
 * candidatas con su frase, que para cinco páginas son unos 40 KB.
 */
export async function POST(request: Request) {
  let body: { candidatas?: unknown; suelo?: unknown } | null;
  try {
    body = (await request.json()) as { candidatas?: unknown; suelo?: unknown } | null;
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const suelo = body?.suelo;
  if (!esNivel(suelo)) {
    return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
  }

  // Una candidata mal formada se descarta; no puede tumbar la extracción entera.
  const candidatas: Candidata[] = (Array.isArray(body?.candidatas) ? body.candidatas : []).filter(
    (c): c is Candidata =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Candidata).texto === "string" &&
      typeof (c as Candidata).frase === "string",
  );

  if (candidatas.length === 0) {
    return NextResponse.json({ error: "No se ha encontrado texto que analizar." }, { status: 400 });
  }

  try {
    const sugerencias = await buscarSugerencias(getDb(), candidatas, suelo);
    return NextResponse.json({ sugerencias });
  } catch (error) {
    // Sin este catch, Next devuelve un 500 con cuerpo HTML; el navegador
    // revienta al leerlo como JSON y el usuario acaba viendo un mensaje interno
    // del navegador. La causa más probable es que falten los niveles.
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      {
        error:
          `No se pudo analizar el texto: ${detalle}. ` +
          "Si es la primera vez que extraes sin IA, comprueba que has aplicado las " +
          "migraciones y cargado los niveles del MCER.",
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/api/extraer-sin-ia.test.ts`
Esperado: PASA, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add app/api/extraer-sin-ia/route.ts tests/api/extraer-sin-ia.test.ts
git commit -m "Ruta que devuelve las candidatas de un texto, sin llamar a nadie"
```

---

### Task 7: Leer el texto del PDF en el navegador

**Files:**
- Create: `lib/extraer/pdf-texto.ts`
- Modify: `package.json` (dependencia)
- Test: `tests/extraer/pdf-texto.test.ts`

**Interfaces:**
- Consumes: `pdfjs-dist`.
- Produces: `export async function textoDePaginas(bytes: Uint8Array, desde: number, hasta: number): Promise<string>`

**La dependencia, ya medida:** `pdfjs-dist@6.3.289`. Su API pesa **129 KB comprimido** y su motor de análisis otros **366 KB**, pero ese solo se descarga al abrir un PDF de verdad. **Impórtalo con `await import(...)` dentro de la función**, no arriba del fichero: así no entra en el paquete que se descarga al abrir la aplicación desde el icono del móvil, que es como la usa el usuario.

**No se puede probar la lectura de un PDF real sin fixtures binarios**, y este proyecto no tiene ninguno. Prueba lo que sí es lógica: la validación del rango y el pegado de las páginas. La lectura de verdad la comprueba el usuario.

- [ ] **Step 1: Instala la dependencia**

```bash
npm install pdfjs-dist@6.3.289
```

Comprueba que `package.json` la lista en `dependencies` y que `package-lock.json` se ha actualizado.

- [ ] **Step 2: Escribe la prueba que falla**

Crea `tests/extraer/pdf-texto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { textoDePaginas } from "@/lib/extraer/pdf-texto";

const vacio = new Uint8Array([1, 2, 3]);

describe("textoDePaginas", () => {
  /**
   * El rango se valida antes de tocar el PDF: un rango imposible no debe
   * gastar el tiempo de cargar el lector, que pesa medio mega.
   */
  it("rechaza un rango imposible sin cargar el lector", async () => {
    await expect(textoDePaginas(vacio, 0, 5)).rejects.toThrow(/rango/i);
    await expect(textoDePaginas(vacio, 5, 2)).rejects.toThrow(/rango/i);
    await expect(textoDePaginas(vacio, 1.5, 3)).rejects.toThrow(/rango/i);
  });

  /**
   * Un PDF ilegible tiene que dar un mensaje que el usuario entienda, no la
   * excepción interna del lector.
   */
  it("un PDF que no se puede abrir da un mensaje en español", async () => {
    await expect(textoDePaginas(vacio, 1, 1)).rejects.toThrow(/no se pudo leer el pdf/i);
  });
});
```

- [ ] **Step 3: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/extraer/pdf-texto.test.ts`
Esperado: FALLA con `Failed to resolve import "@/lib/extraer/pdf-texto"`.

- [ ] **Step 4: Escribe el módulo**

Crea `lib/extraer/pdf-texto.ts`:

```ts
/**
 * Saca el texto de un rango de páginas de un PDF, **en el navegador**.
 *
 * El PDF no sale del dispositivo: al servidor solo viajan después las cadenas
 * candidatas, que para cinco páginas son unos 40 KB. Es también lo que libra a
 * esta extracción del límite de 4,5 MB por petición que obligó a trocear la
 * extracción con IA.
 *
 * **El lector se importa aquí dentro y no arriba del fichero**, a propósito: su
 * API pesa 129 KB comprimido y su motor de análisis otros 366 KB. Con la
 * importación diferida nada de eso entra en el paquete que se descarga al abrir
 * la aplicación desde el icono del móvil; se pide la primera vez que se lee un
 * PDF y ya se queda.
 *
 * Solo lee PDFs **con texto dentro**. Un escaneo es una imagen y devolverá
 * cadena vacía; quien llame tiene que decírselo al usuario con esas palabras.
 */
export async function textoDePaginas(
  bytes: Uint8Array,
  desde: number,
  hasta: number,
): Promise<string> {
  if (
    !Number.isInteger(desde) ||
    !Number.isInteger(hasta) ||
    desde < 1 ||
    hasta < desde
  ) {
    throw new Error("El rango de páginas no es válido.");
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  let documento;
  try {
    documento = await pdfjs.getDocument({ data: bytes }).promise;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "";
    throw new Error(
      `No se pudo leer el PDF: puede estar cifrado o dañado.${detalle ? ` (${detalle})` : ""}`,
    );
  }

  const trozos: string[] = [];
  const ultima = Math.min(hasta, documento.numPages);
  for (let pagina = desde; pagina <= ultima; pagina += 1) {
    const contenido = await (await documento.getPage(pagina)).getTextContent();
    trozos.push(
      contenido.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }

  return trozos.join("\n");
}
```

- [ ] **Step 5: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/extraer/pdf-texto.test.ts`
Esperado: PASA, 2 pruebas.

Si la segunda prueba falla porque `pdfjs-dist` no arranca en `environment: "node"`, **no cambies el entorno de las pruebas ni añadas jsdom**. Reporta DONE_WITH_CONCERNS explicando el fallo exacto: puede que haya que quedarse solo con la prueba del rango, que es la que no toca el lector.

- [ ] **Step 6: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint . && npm run build
git add lib/extraer/pdf-texto.ts package.json package-lock.json tests/extraer/pdf-texto.test.ts
git commit -m "Leer el texto de un PDF en el navegador, con carga diferida"
```

`npm run build` importa aquí más que en otras tareas: es lo que demuestra que la dependencia nueva no rompe la compilación de producción.

---

### Task 8: Guardar varias palabras de una vez

**Files:**
- Modify: `db/repository/diccionario.ts` (al final)
- Modify: `app/api/terms/route.ts`
- Test: `tests/db/extraccion-lote.test.ts`

**Interfaces:**
- Consumes: `anadirDesdeDiccionario` de `@/db/repository/diccionario`.
- Produces:
  - `export async function anadirVariasDesdeDiccionario(db: Database, entradas: Array<{ term: string; pos: string; gloss: string; example: string | null; translation: string; level: string }>): Promise<{ creadas: number; repetidas: number }>`
  - `POST /api/terms` acepta además `{ entradas: [...] }` y devuelve `{ creadas, repetidas }`.

**Por qué:** marcar cuarenta candidatas no puede ser cuarenta peticiones.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/db/extraccion-lote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { anadirVariasDesdeDiccionario } from "@/db/repository/diccionario";
import { terms, cardStates } from "@/db/schema";

const entrada = (term: string, gloss: string) => ({
  term, pos: "noun", gloss, example: null, translation: "algo", level: "B2",
});

describe("anadirVariasDesdeDiccionario", () => {
  it("crea todas y cuenta cuántas", async () => {
    const { db, close } = await createTestDb();

    const r = await anadirVariasDesdeDiccionario(db, [
      entrada("dog", "An animal."),
      entrada("house", "A building."),
    ]);

    expect(r).toEqual({ creadas: 2, repetidas: 0 });
    expect(await db.select().from(terms)).toHaveLength(2);
    await close();
  });

  /** Cada término gana su ficha de repaso, o no aparecería nunca en la sesión. */
  it("cada término creado gana su ficha de repaso", async () => {
    const { db, close } = await createTestDb();
    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")]);

    expect(await db.select().from(cardStates)).toHaveLength(1);
    await close();
  });

  it("lo que ya estaba no se duplica, y se cuenta aparte", async () => {
    const { db, close } = await createTestDb();
    await anadirVariasDesdeDiccionario(db, [entrada("dog", "An animal.")]);

    const r = await anadirVariasDesdeDiccionario(db, [
      entrada("dog", "An animal."),
      entrada("cat", "Another animal."),
    ]);

    expect(r).toEqual({ creadas: 1, repetidas: 1 });
    expect(await db.select().from(terms)).toHaveLength(2);
    await close();
  });

  it("con la lista vacía no crea nada", async () => {
    const { db, close } = await createTestDb();
    expect(await anadirVariasDesdeDiccionario(db, [])).toEqual({ creadas: 0, repetidas: 0 });
    await close();
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/db/extraccion-lote.test.ts`
Esperado: FALLA con `anadirVariasDesdeDiccionario is not a function`.

- [ ] **Step 3: Escribe la función**

Al final de `db/repository/diccionario.ts`:

```ts
/**
 * Añade varias acepciones de una vez.
 *
 * Existe porque marcar cuarenta candidatas en una extracción no puede ser
 * cuarenta viajes al servidor. Reutiliza `anadirDesdeDiccionario` una por una:
 * cada llamada abre su propia transacción, así que **una que falle no deshace
 * las anteriores**, que es lo que se quiere aquí — perder treinta y nueve
 * palabras buenas por una mala sería peor que guardarlas.
 */
export async function anadirVariasDesdeDiccionario(
  db: Database,
  entradas: Array<{
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translation: string;
    level: string;
  }>,
): Promise<{ creadas: number; repetidas: number }> {
  let creadas = 0;
  let repetidas = 0;
  for (const entrada of entradas) {
    const { created } = await anadirDesdeDiccionario(db, entrada);
    if (created) creadas += 1;
    else repetidas += 1;
  }
  return { creadas, repetidas };
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/db/extraccion-lote.test.ts`
Esperado: PASA, 4 pruebas.

- [ ] **Step 5: Acepta el lote en la ruta**

Lee primero `app/api/terms/route.ts` entero para ver cómo valida hoy una entrada suelta. Añade `entradas` al tipo del cuerpo:

```ts
type EntradaTermino = {
  term?: string;
  pos?: string;
  gloss?: string;
  example?: string | null;
  translation?: string;
  level?: string;
};

type PostBody = EntradaTermino & { entradas?: EntradaTermino[] };
```

Y dentro de `POST`, **antes** de la validación de la entrada suelta:

```ts
  // El camino del lote: una extracción marca cuarenta candidatas de una vez, y
  // cuarenta peticiones serían cuarenta viajes al servidor. El camino de una
  // sola entrada, que es el que usa la pantalla del diccionario, sigue intacto
  // debajo.
  if (Array.isArray(body?.entradas)) {
    const validas = body.entradas.filter(
      (e): e is Required<Pick<EntradaTermino, "term" | "pos" | "gloss" | "translation" | "level">> &
        EntradaTermino =>
        esCadena(e?.term) &&
        esCadena(e?.pos) &&
        esCadena(e?.gloss) &&
        esCadena(e?.translation) &&
        esCadena(e?.level) &&
        isCefrLevel(e.level as string),
    );

    if (validas.length === 0) {
      return NextResponse.json(
        { error: "Ninguna de las palabras enviadas está completa." },
        { status: 400 },
      );
    }

    const resultado = await anadirVariasDesdeDiccionario(
      getDb(),
      validas.map((e) => ({
        term: e.term as string,
        pos: e.pos as string,
        gloss: e.gloss as string,
        example: e.example ?? null,
        translation: e.translation as string,
        level: e.level as string,
      })),
    );
    return NextResponse.json(resultado);
  }
```

Usa el ayudante `esCadena` y el `isCefrLevel` que el fichero ya tiene; si el nombre del ayudante es otro, usa el que haya en vez de crear uno nuevo. Añade `anadirVariasDesdeDiccionario` al import de `@/db/repository/diccionario`.

Y añade a `tests/api/terms.test.ts`:

```ts
  it("guarda un lote entero en una sola petición", async () => {
    const res = await POST(
      new Request("http://localhost/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entradas: [
            { term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" },
            { term: "cat", pos: "noun", gloss: "Another.", example: null, translation: "gato", level: "B1" },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ creadas: 2, repetidas: 0 });
  });

  /** El camino viejo, el de la pantalla del diccionario, no puede cambiar. */
  it("una sola entrada sigue funcionando como antes", async () => {
    const res = await POST(
      new Request("http://localhost/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: "house", pos: "noun", gloss: "A building.",
          example: null, translation: "casa", level: "A1",
        }),
      }),
    );

    expect(res.status).toBe(200);
  });
```

Adapta el montaje de la petición a como lo hace ese fichero: mira si simula el repositorio con `vi.mock` o usa PGlite, y **sigue su patrón** en vez de introducir otro.

- [ ] **Step 6: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add db/repository/diccionario.ts app/api/terms/route.ts tests/
git commit -m "Guardar varias palabras de una extracción en una sola petición"
```

---

### Task 9: La pantalla

**Files:**
- Create: `components/ExtraerSinIA.tsx`
- Modify: `app/extraer/page.tsx`
- Test: `tests/extraer-sin-ia-pantalla.test.ts`

**Interfaces:**
- Consumes: `textoDePaginas`, `candidatasDeTexto`, `Sugerencia`, `CEFR_LEVELS` de `@/lib/extraction-schema`.
- Produces, todas exportadas y puras:
  - `export function etiquetaDeNivel(nivel: string | null, suelo: string): string`
  - `export function nivelParaGuardar(nivel: string | null, suelo: string): string`
  - `export function avisoSinSugerencias(hayTexto: boolean, numCandidatas: number, numSugerencias: number): "sin-texto" | "nada-nuevo" | null`
  - `export async function pedirSugerencias(candidatas, suelo, fetchImpl?): Promise<Sugerencia[]>`
  - `export async function guardarMarcadas(entradas, fetchImpl?): Promise<{ creadas: number; repetidas: number }>`

**El patrón del proyecto:** las pruebas corren sin jsdom, así que **la lógica que puede fallar se extrae del componente como función pura exportada y el componente solo pinta y guarda estado**. Mira `components/BuscadorDiccionario.tsx` para copiarlo.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/extraer-sin-ia-pantalla.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  avisoSinSugerencias,
  etiquetaDeNivel,
  guardarMarcadas,
  nivelParaGuardar,
  pedirSugerencias,
} from "@/components/ExtraerSinIA";

describe("etiquetaDeNivel", () => {
  it("dice el nivel cuando está medido", () => {
    expect(etiquetaDeNivel("B2", "B1")).toBe("B2");
  });

  /**
   * Un verbo frasal no tiene nivel en ninguna fuente gratuita. Enseñar el suelo
   * como si fuera suyo sería fingir una precisión que no hay.
   */
  it("cuando no está medido lo dice, no finge", () => {
    expect(etiquetaDeNivel(null, "B1")).toBe("sin nivel");
  });
});

describe("nivelParaGuardar", () => {
  it("guarda el nivel medido cuando lo hay", () => {
    expect(nivelParaGuardar("C1", "B1")).toBe("C1");
  });

  it("y el suelo elegido cuando no lo hay", () => {
    expect(nivelParaGuardar(null, "B1")).toBe("B1");
  });
});

describe("avisoSinSugerencias", () => {
  it("no avisa de nada si hay sugerencias", () => {
    expect(avisoSinSugerencias(true, 100, 5)).toBeNull();
  });

  /** Un PDF escaneado es una imagen: no hay texto que analizar. */
  it("distingue un PDF sin texto de un filtro que no dejó pasar nada", () => {
    expect(avisoSinSugerencias(false, 0, 0)).toBe("sin-texto");
    expect(avisoSinSugerencias(true, 100, 0)).toBe("nada-nuevo");
  });
});

describe("pedirSugerencias", () => {
  it("manda las candidatas y el suelo, y devuelve lo que llega", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ sugerencias: [{ term: "abandon" }] })),
    );

    const s = await pedirSugerencias(
      [{ texto: "abandon", frase: "He abandoned it." }],
      "B2",
      fetchFalso as unknown as typeof fetch,
    );

    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(cuerpo.suelo).toBe("B2");
    expect(cuerpo.candidatas).toHaveLength(1);
    expect(s).toEqual([{ term: "abandon" }]);
  });

  it("un fallo de red da un mensaje en español, no deja la pantalla colgada", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      pedirSugerencias([{ texto: "a", frase: "b" }], "B2", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow(/conexión/i);
  });

  it("un error del servidor se propaga con su mensaje", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Faltan los niveles." }), { status: 500 }),
    );
    await expect(
      pedirSugerencias([{ texto: "a", frase: "b" }], "B2", fetchFalso as unknown as typeof fetch),
    ).rejects.toThrow("Faltan los niveles.");
  });
});

describe("guardarMarcadas", () => {
  it("manda todo en una sola petición", async () => {
    const fetchFalso = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ creadas: 2, repetidas: 0 })),
    );
    const entradas = [
      { term: "dog", pos: "noun", gloss: "An animal.", example: null, translation: "perro", level: "B1" },
      { term: "cat", pos: "noun", gloss: "Another.", example: null, translation: "gato", level: "B1" },
    ];

    const r = await guardarMarcadas(entradas, fetchFalso as unknown as typeof fetch);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchFalso.mock.calls[0][1]?.body)).entradas).toHaveLength(2);
    expect(r).toEqual({ creadas: 2, repetidas: 0 });
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/extraer-sin-ia-pantalla.test.ts`
Esperado: FALLA con `Failed to resolve import "@/components/ExtraerSinIA"`.

- [ ] **Step 3: Escribe las funciones puras**

Crea `components/ExtraerSinIA.tsx`, con `"use client"` en la primera línea, y estas cinco funciones exportadas antes del componente:

```tsx
export type Sugerencia = {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  frase: string;
  significados: string[];
  nivel: string | null;
  tipo: "word" | "phrasal_verb" | "expression";
};

/**
 * Qué nivel se enseña de una candidata. Un verbo frasal no tiene nivel en
 * ninguna fuente gratuita: enseñar el suelo elegido como si fuera suyo sería
 * fingir una precisión que no existe, así que se dice que no lo hay.
 */
export function etiquetaDeNivel(nivel: string | null, _suelo: string): string {
  return nivel ?? "sin nivel";
}

/**
 * Qué nivel se guarda en la tarjeta. `terms.level` no admite nulos, así que lo
 * que no tiene nivel medido hereda el suelo elegido — que es exactamente lo que
 * hace hoy la extracción con IA con **todas** sus palabras, así que no empeora
 * nada. La pantalla distingue las dos cosas con `etiquetaDeNivel`.
 */
export function nivelParaGuardar(nivel: string | null, suelo: string): string {
  return nivel ?? suelo;
}

/**
 * Por qué no hay nada que enseñar, que no es lo mismo según el caso. Un
 * resultado vacío sin explicación es lo que hace pensar que la herramienta está
 * rota.
 */
export function avisoSinSugerencias(
  hayTexto: boolean,
  _numCandidatas: number,
  numSugerencias: number,
): "sin-texto" | "nada-nuevo" | null {
  if (numSugerencias > 0) return null;
  return hayTexto ? "nada-nuevo" : "sin-texto";
}

export async function pedirSugerencias(
  candidatas: Array<{ texto: string; frase: string }>,
  suelo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sugerencia[]> {
  let res: Response;
  try {
    res = await fetchImpl("/api/extraer-sin-ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidatas, suelo }),
    });
  } catch {
    // Un fallo de red sin mensaje dejaría el formulario deshabilitado para
    // siempre, sin decirle nada al usuario.
    throw new Error("No se pudo analizar el texto: comprueba la conexión.");
  }
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (cuerpo as { error?: string } | null)?.error ??
        `El servidor no pudo analizar el texto (error ${res.status}).`,
    );
  }
  return ((cuerpo as { sugerencias?: Sugerencia[] } | null)?.sugerencias ?? []) as Sugerencia[];
}

/** Todo lo marcado en **una sola petición**: cuarenta candidatas no pueden ser cuarenta viajes. */
export async function guardarMarcadas(
  entradas: Array<{
    term: string;
    pos: string;
    gloss: string;
    example: string | null;
    translation: string;
    level: string;
  }>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ creadas: number; repetidas: number }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entradas }),
    });
  } catch {
    throw new Error("No se pudo guardar: comprueba la conexión.");
  }
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (cuerpo as { error?: string } | null)?.error ??
        `El servidor no pudo guardar las palabras (error ${res.status}).`,
    );
  }
  return cuerpo as { creadas: number; repetidas: number };
}
```

- [ ] **Step 4: Escribe el componente**

En el mismo fichero, debajo. Sigue el patrón de `components/BuscadorDiccionario.tsx`: el componente **solo pinta y guarda estado**, y todo lo que puede fallar ya está arriba en funciones puras. La pantalla, según la especificación §8:

- El formulario de siempre: fichero, rango de páginas y **el selector de nivel, que aquí es el suelo del filtro**. Su etiqueta y su ayuda tienen que decirlo — en el otro botón significa otra cosa.
- Al enviar: `textoDePaginas` → `candidatasDeTexto` → `pedirSugerencias`.
- La lista, en el orden en que llega del servidor: **primero los verbos frasales y las expresiones**, después las sueltas de más difícil a más fácil.
- Cada línea: la palabra; si es frasal o expresión, dicho; **la frase del libro**; sus significados en español; y su nivel con `etiquetaDeNivel`.
- Una casilla por línea y un único botón de guardar, con `guardarMarcadas`.
- Sin sugerencias: el aviso que diga `avisoSinSugerencias`. **«sin-texto» tiene que explicar que el PDF puede ser un escaneo**, que es la causa más probable y la que el usuario no puede adivinar.

En `app/extraer/page.tsx`, pon los dos caminos con sus nombres y su coste a la vista: el de IA como está, y este debajo, diciendo que es gratis.

- [ ] **Step 5: Ejecuta las pruebas para verlas pasar**

Ejecuta: `npx vitest run tests/extraer-sin-ia-pantalla.test.ts`
Esperado: PASA, 9 pruebas.

- [ ] **Step 6: NO lo compruebes en el navegador**

No arranques ningún servidor de desarrollo: la aplicación pide contraseña, que no tienes ni debes pedir. La comprobación visual la hace el usuario en su móvil. Dilo en tu informe.

- [ ] **Step 7: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint . && npm run build
git add components/ExtraerSinIA.tsx app/extraer/page.tsx tests/extraer-sin-ia-pantalla.test.ts
git commit -m "La pantalla de extraer sin IA"
```

---

## Al terminar

1. **Ejecuta todo**: `npx vitest run --no-file-parallelism`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
2. **Repasa la especificación** de arriba abajo y comprueba que cada sección tiene su código.
3. **No apliques la migración ni cargues los niveles en la base real.** Deja en el informe final los comandos exactos que tiene que ejecutar el usuario. La migración va **a mano, ejecutando el `.sql`**, no con `drizzle-kit push`.
4. **Tras cargar los niveles, hay que comparar el total de filas contra el fichero fuente, no solo contarlas.** En la carga anterior de este proyecto las filas cuadraban y faltaban 25 significados; se descubrió comparando uno a uno.
