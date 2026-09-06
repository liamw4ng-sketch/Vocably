# AppVocabulario — Fase 1: extracción y biblioteca

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir un PDF, extraer de un rango de páginas el vocabulario de un nivel del MCER con la API de Claude, y guardarlo automáticamente en una biblioteca editable que persiste entre sesiones.

**Architecture:** Una aplicación Next.js (App Router) desplegada en Vercel. El navegador recorta el rango de páginas con `pdf-lib` y lo envía en lotes de 5 páginas a `POST /api/extract`; cada lote llama a `claude-opus-5` con salida estructurada y se guarda en Postgres antes de pedir el siguiente. El vocabulario se deduplica por término normalizado: un término repetido suma una aparición nueva en lugar de crear una tarjeta nueva.

**Tech Stack:** Next.js (App Router) · TypeScript · Tailwind · Drizzle ORM · Postgres (Neon) · `@anthropic-ai/sdk` · `zod` · `pdf-lib` · Vitest · PGlite (Postgres en memoria, solo para pruebas)

**Spec:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`

## Global Constraints

- **Modelo:** `claude-opus-5`. No sustituirlo por otro sin decisión explícita del usuario.
- **Precio para calcular coste:** 5 $ por millón de tokens de entrada, 25 $ por millón de salida.
- **Tamaño de lote:** 5 páginas por petición a `/api/extract`.
- **`max_tokens`:** 16000, sin streaming.
- **El PDF original nunca se guarda** ni en disco ni en base de datos.
- **Los secretos** (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`) solo se leen en código de servidor. Nunca con prefijo `NEXT_PUBLIC_`.
- **Las pruebas no llaman a la API de Claude.** Se usan respuestas grabadas.
- **Idioma de la interfaz:** español.
- **Tipos de término permitidos:** exactamente `word`, `phrasal_verb`, `expression`.
- **Niveles permitidos:** exactamente `A1`, `A2`, `B1`, `B2`, `C1`, `C2`.

---

## Estructura de ficheros

Todo cuelga de la raíz del proyecto; el alias `@/*` apunta a la raíz.

| Fichero | Responsabilidad |
|---|---|
| `lib/normalize.ts` | Normalizar un término para comparar duplicados |
| `lib/cost.ts` | Convertir consumo de tokens en dólares |
| `lib/extraction-schema.ts` | Esquema zod del resultado y tipos compartidos |
| `lib/prompt.ts` | Construir el prompt de extracción a partir del nivel |
| `lib/anthropic-extract.ts` | Llamar a Claude con el PDF y devolver términos + coste |
| `lib/pdf-slice.ts` | Recortar páginas y planificar lotes (navegador) |
| `lib/run-extraction.ts` | Orquestar los lotes en secuencia (navegador) |
| `lib/auth.ts` | Firmar y verificar la cookie de sesión |
| `db/schema.ts` | Definición de las cinco tablas |
| `db/client.ts` | Conexión a Postgres en producción |
| `db/types.ts` | Tipo `Database` que aceptan los repositorios |
| `db/repository/extraction.ts` | Guardar una extracción con deduplicación |
| `db/repository/terms.ts` | Listar, editar y borrar términos |
| `app/api/extract/route.ts` | Endpoint de extracción de un lote |
| `app/api/login/route.ts` | Entrada con contraseña |
| `app/api/terms/route.ts` | Listado de la biblioteca |
| `app/api/terms/[id]/route.ts` | Editar y borrar un término |
| `app/extraer/page.tsx` | Pantalla de extracción |
| `app/biblioteca/page.tsx` | Pantalla de biblioteca |
| `components/ExtractForm.tsx` | Formulario y progreso de la extracción |
| `components/TermTable.tsx` | Tabla editable de términos |
| `middleware.ts` | Protección de todas las rutas salvo la de entrada |
| `tests/helpers/test-db.ts` | Base de datos en memoria para las pruebas |

---

### Task 1: Base del proyecto y normalización de términos

**Files:**
- Create: raíz del proyecto Next.js (`package.json`, `tsconfig.json`, `app/`, ...)
- Create: `vitest.config.ts`
- Create: `lib/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `normalizeTerm(term: string): string` — la clave de deduplicación que usan las tareas 3 y 7.

- [ ] **Step 1: Generar el proyecto Next.js fuera del repositorio y moverlo dentro**

La carpeta ya contiene `docs/` y `.git`, y `create-next-app` se niega a escribir en un directorio con ficheros propios. Se genera aparte y se copia:

```bash
npx create-next-app@latest /tmp/appvocab-scaffold --yes --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
rsync -a --exclude '.git' /tmp/appvocab-scaffold/ .
rm -rf /tmp/appvocab-scaffold
```

- [ ] **Step 2: Instalar las dependencias del proyecto**

```bash
npm install @anthropic-ai/sdk zod drizzle-orm @neondatabase/serverless pdf-lib
npm install -D vitest @vitejs/plugin-react drizzle-kit @electric-sql/pglite
```

- [ ] **Step 3: Configurar Vitest**

Crear `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

Añadir a `package.json`, dentro de `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Escribir la prueba que falla**

Crear `tests/normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeTerm } from "@/lib/normalize";

describe("normalizeTerm", () => {
  it("pasa a minúsculas", () => {
    expect(normalizeTerm("Come Across")).toBe("come across");
  });

  it("quita los espacios de los extremos", () => {
    expect(normalizeTerm("  give up  ")).toBe("give up");
  });

  it("colapsa los espacios interiores", () => {
    expect(normalizeTerm("look   forward   to")).toBe("look forward to");
  });

  it("trata el tabulador y el salto de línea como espacio", () => {
    expect(normalizeTerm("put\tup\nwith")).toBe("put up with");
  });

  it("es idempotente", () => {
    const once = normalizeTerm("  Take   OFF ");
    expect(normalizeTerm(once)).toBe(once);
  });

  it("conserva los acentos como caracteres compuestos iguales", () => {
    expect(normalizeTerm("café")).toBe(normalizeTerm("café"));
  });
});
```

- [ ] **Step 5: Ejecutar la prueba y comprobar que falla**

Run: `npm test -- tests/normalize.test.ts`
Expected: FAIL — no se puede resolver `@/lib/normalize`.

- [ ] **Step 6: Escribir la implementación mínima**

Crear `lib/normalize.ts`:

```typescript
/** Clave de comparación de términos: dos términos con la misma clave son el mismo. */
export function normalizeTerm(term: string): string {
  return term.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}
```

- [ ] **Step 7: Ejecutar la prueba y comprobar que pasa**

Run: `npm test -- tests/normalize.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: base del proyecto Next.js y normalización de términos"
```

---

### Task 2: Esquema de base de datos

**Files:**
- Create: `db/schema.ts`
- Create: `db/types.ts`
- Create: `drizzle.config.ts`
- Create: `tests/helpers/test-db.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: las tablas `sources`, `terms`, `termOccurrences`, `cardStates`, `reviewLogs`, el tipo `Database` que aceptan todos los repositorios, y `createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }>` que usan las tareas 3, 7 y 10.

- [ ] **Step 1: Definir el esquema**

Crear `db/schema.ts`:

```typescript
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  level: text("level").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
});

export const terms = pgTable(
  "terms",
  {
    id: serial("id").primaryKey(),
    term: text("term").notNull(),
    termNormalized: text("term_normalized").notNull(),
    type: text("type").notNull(),
    translation: text("translation").notNull(),
    level: text("level").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    termNormalizedIdx: uniqueIndex("terms_term_normalized_idx").on(table.termNormalized),
  }),
);

export const termOccurrences = pgTable("term_occurrences", {
  id: serial("id").primaryKey(),
  termId: integer("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  context: text("context").notNull(),
  example: text("example").notNull(),
});

/** Estado de repetición espaciada. Se crea en la fase 1; lo usa la fase 2. */
export const cardStates = pgTable("card_states", {
  termId: integer("term_id")
    .primaryKey()
    .references(() => terms.id, { onDelete: "cascade" }),
  due: timestamp("due").notNull().defaultNow(),
  stability: doublePrecision("stability").notNull().default(0),
  difficulty: doublePrecision("difficulty").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  state: integer("state").notNull().default(0),
  lastReview: timestamp("last_review"),
});

/** Histórico de respuestas. Vacío en la fase 1; se crea para no perder datos después. */
export const reviewLogs = pgTable("review_logs", {
  id: serial("id").primaryKey(),
  termId: integer("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  state: integer("state").notNull(),
  stability: doublePrecision("stability").notNull(),
  difficulty: doublePrecision("difficulty").notNull(),
  reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Definir el tipo de base de datos que aceptan los repositorios**

Crear `db/types.ts`:

```typescript
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

/**
 * Cualquier instancia de Drizzle sobre este esquema: la de producción y la de
 * pruebas en memoria. Los repositorios dependen de este tipo y nunca de una
 * conexión concreta, para que el código de producción no importe nada de tests/.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
```

Si TypeScript se queja al pasar la base de pruebas a un repositorio, ensanchar el
primer parámetro a `PgDatabase<any, typeof schema>`: los dos controladores tienen
tipos de resultado distintos y solo coinciden en la parte que usamos.

- [ ] **Step 3: Configurar drizzle-kit y generar la migración**

Crear `drizzle.config.ts`:

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
} satisfies Config;
```

Run: `npx drizzle-kit generate`
Expected: aparece un `.sql` nuevo dentro de `drizzle/`.

- [ ] **Step 4: Crear la base de datos de pruebas en memoria**

Crear `tests/helpers/test-db.ts`:

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Postgres en memoria con las migraciones aplicadas. No toca ninguna base real. */
export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}
```

- [ ] **Step 5: Escribir la prueba que falla**

Crear `tests/db/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { sources, terms } from "@/db/schema";

describe("esquema", () => {
  it("guarda y recupera una fuente", async () => {
    const { db, close } = await createTestDb();
    await db.insert(sources).values({
      title: "Cambridge B2 First",
      pageStart: 12,
      pageEnd: 18,
      level: "B2",
    });
    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Cambridge B2 First");
    expect(rows[0].costUsd).toBe(0);
    await close();
  });

  it("rechaza dos términos con la misma forma normalizada", async () => {
    const { db, close } = await createTestDb();
    const row = {
      term: "come across",
      termNormalized: "come across",
      type: "phrasal_verb",
      translation: "encontrarse con",
      level: "B2",
    };
    await db.insert(terms).values(row);
    await expect(db.insert(terms).values(row)).rejects.toThrow();
    await close();
  });
});
```

- [ ] **Step 6: Ejecutar las pruebas y comprobar que pasan**

Run: `npm test -- tests/db/schema.test.ts`
Expected: PASS, 2 pruebas. Si falla al aplicar migraciones, revisar que el paso 3 generó el `.sql` en `drizzle/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: esquema de base de datos, tipo Database y base de pruebas en memoria"
```

---

### Task 3: Guardado con deduplicación

**Files:**
- Create: `db/repository/extraction.ts`
- Test: `tests/db/extraction.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` (tarea 1), esquema y `createTestDb` (tarea 2).
- Produces:
  - `type ExtractedTerm = { term: string; type: "word" | "phrasal_verb" | "expression"; translation: string; context: string; example: string }`
  - `saveExtraction(db, input: SaveExtractionInput): Promise<SaveExtractionResult>` donde
    `SaveExtractionInput = { title: string; pageStart: number; pageEnd: number; level: string; inputTokens: number; outputTokens: number; costUsd: number; items: ExtractedTerm[] }`
    y `SaveExtractionResult = { sourceId: number; created: number; merged: number }`.
    Lo consumen las tareas 7 y 9.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/db/extraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { terms, termOccurrences, cardStates } from "@/db/schema";
import { eq } from "drizzle-orm";

const base = {
  title: "Libro",
  pageStart: 1,
  pageEnd: 5,
  level: "B2",
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
};

const comeAcross = {
  term: "come across",
  type: "phrasal_verb" as const,
  translation: "encontrarse con",
  context: "I came across an old photo.",
  example: "I came across a useful word today.",
};

describe("saveExtraction", () => {
  it("crea el término, su aparición y su tarjeta", async () => {
    const { db, close } = await createTestDb();
    const result = await saveExtraction(db, { ...base, items: [comeAcross] });

    expect(result.created).toBe(1);
    expect(result.merged).toBe(0);

    const savedTerms = await db.select().from(terms);
    expect(savedTerms).toHaveLength(1);
    expect(savedTerms[0].termNormalized).toBe("come across");

    const cards = await db.select().from(cardStates);
    expect(cards).toHaveLength(1);
    expect(cards[0].reps).toBe(0);
    await close();
  });

  it("no duplica un término ya guardado: añade solo la aparición", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    const result = await saveExtraction(db, {
      ...base,
      title: "Otro libro",
      items: [{ ...comeAcross, context: "We came across a problem." }],
    });

    expect(result.created).toBe(0);
    expect(result.merged).toBe(1);
    expect(await db.select().from(terms)).toHaveLength(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(2);
    await close();
  });

  it("ignora mayúsculas y espacios al detectar el duplicado", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    const result = await saveExtraction(db, {
      ...base,
      items: [{ ...comeAcross, term: "  Come   Across " }],
    });

    expect(result.merged).toBe(1);
    expect(await db.select().from(terms)).toHaveLength(1);
    await close();
  });

  it("conserva la traducción corregida a mano cuando el término se repite", async () => {
    const { db, close } = await createTestDb();
    await saveExtraction(db, { ...base, items: [comeAcross] });
    await db
      .update(terms)
      .set({ translation: "toparse con" })
      .where(eq(terms.termNormalized, "come across"));

    await saveExtraction(db, {
      ...base,
      items: [{ ...comeAcross, translation: "encontrarse con" }],
    });

    const saved = await db.select().from(terms);
    expect(saved[0].translation).toBe("toparse con");
    await close();
  });

  it("deduplica también dentro del mismo lote", async () => {
    const { db, close } = await createTestDb();
    const result = await saveExtraction(db, {
      ...base,
      items: [comeAcross, { ...comeAcross, term: "Come across" }],
    });

    expect(result.created).toBe(1);
    expect(result.merged).toBe(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(2);
    await close();
  });

  it("guarda el consumo y el coste en la fuente", async () => {
    const { db, close } = await createTestDb();
    const { sourceId } = await saveExtraction(db, { ...base, items: [comeAcross] });
    const source = await db.query.sources.findFirst({
      where: (s, { eq: equals }) => equals(s.id, sourceId),
    });
    expect(source?.costUsd).toBeCloseTo(0.001);
    expect(source?.inputTokens).toBe(100);
    await close();
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas y comprobar que fallan**

Run: `npm test -- tests/db/extraction.test.ts`
Expected: FAIL — no se puede resolver `@/db/repository/extraction`.

- [ ] **Step 3: Escribir la implementación**

Crear `db/repository/extraction.ts`:

```typescript
import { eq } from "drizzle-orm";
import { normalizeTerm } from "@/lib/normalize";
import { sources, terms, termOccurrences, cardStates } from "@/db/schema";
import type { Database } from "@/db/types";

export type TermType = "word" | "phrasal_verb" | "expression";

export type ExtractedTerm = {
  term: string;
  type: TermType;
  translation: string;
  context: string;
  example: string;
};

export type SaveExtractionInput = {
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  items: ExtractedTerm[];
};

export type SaveExtractionResult = {
  sourceId: number;
  created: number;
  merged: number;
};

export async function saveExtraction(
  db: Database,
  input: SaveExtractionInput,
): Promise<SaveExtractionResult> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({
        title: input.title,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        level: input.level,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
      })
      .returning({ id: sources.id });

    let created = 0;
    let merged = 0;

    for (const item of input.items) {
      const key = normalizeTerm(item.term);

      const existing = await tx
        .select({ id: terms.id })
        .from(terms)
        .where(eq(terms.termNormalized, key))
        .limit(1);

      let termId: number;

      if (existing.length > 0) {
        termId = existing[0].id;
        merged += 1;
      } else {
        const [inserted] = await tx
          .insert(terms)
          .values({
            term: item.term.trim(),
            termNormalized: key,
            type: item.type,
            translation: item.translation,
            level: input.level,
          })
          .returning({ id: terms.id });
        termId = inserted.id;
        await tx.insert(cardStates).values({ termId });
        created += 1;
      }

      await tx.insert(termOccurrences).values({
        termId,
        sourceId: source.id,
        context: item.context,
        example: item.example,
      });
    }

    return { sourceId: source.id, created, merged };
  });
}
```

El bucle es secuencial a propósito: dos términos iguales dentro del mismo lote tienen que ver el primero ya insertado para fusionarse con él.

- [ ] **Step 4: Ejecutar las pruebas y comprobar que pasan**

Run: `npm test -- tests/db/extraction.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: guardado de extracciones con deduplicación por término normalizado"
```

---

### Task 4: Contrato de extracción y prompt

**Files:**
- Create: `lib/extraction-schema.ts`
- Create: `lib/prompt.ts`
- Test: `tests/extraction-schema.test.ts`
- Test: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `ExtractedTerm` (tarea 3).
- Produces:
  - `extractionSchema` — esquema zod de `{ terms: ExtractedTerm[] }`, para `zodOutputFormat`.
  - `CEFR_LEVELS: readonly string[]` y `isCefrLevel(value: string): boolean`.
  - `buildExtractionPrompt(level: string, pageStart: number, pageEnd: number): string`.
    Los consume la tarea 5.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/extraction-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractionSchema, isCefrLevel } from "@/lib/extraction-schema";

const validTerm = {
  term: "come across",
  type: "phrasal_verb",
  translation: "encontrarse con",
  context: "I came across an old photo.",
  example: "I came across a useful word today.",
};

describe("extractionSchema", () => {
  it("acepta un resultado válido", () => {
    const parsed = extractionSchema.parse({ terms: [validTerm] });
    expect(parsed.terms[0].term).toBe("come across");
  });

  it("acepta una lista vacía", () => {
    expect(extractionSchema.parse({ terms: [] }).terms).toHaveLength(0);
  });

  it("rechaza un tipo de término desconocido", () => {
    expect(() =>
      extractionSchema.parse({ terms: [{ ...validTerm, type: "idiom" }] }),
    ).toThrow();
  });

  it("rechaza un término al que le falta el contexto", () => {
    const { context, ...sinContexto } = validTerm;
    expect(() => extractionSchema.parse({ terms: [sinContexto] })).toThrow();
  });

  it("rechaza un término vacío", () => {
    expect(() => extractionSchema.parse({ terms: [{ ...validTerm, term: "" }] })).toThrow();
  });
});

describe("isCefrLevel", () => {
  it("acepta los seis niveles del MCER", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      expect(isCefrLevel(level)).toBe(true);
    }
  });

  it("rechaza cualquier otra cosa", () => {
    expect(isCefrLevel("B3")).toBe(false);
    expect(isCefrLevel("b2")).toBe(false);
    expect(isCefrLevel("")).toBe(false);
  });
});
```

Crear `tests/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "@/lib/prompt";

describe("buildExtractionPrompt", () => {
  it("incluye el nivel pedido", () => {
    expect(buildExtractionPrompt("B2", 12, 18)).toContain("B2");
  });

  it("incluye el rango de páginas", () => {
    const prompt = buildExtractionPrompt("B2", 12, 18);
    expect(prompt).toContain("12");
    expect(prompt).toContain("18");
  });

  it("exige que el término aparezca en el texto", () => {
    expect(buildExtractionPrompt("A2", 1, 5)).toMatch(/literalmente/i);
  });

  it("exige que el contexto sea una frase copiada", () => {
    expect(buildExtractionPrompt("A2", 1, 5)).toMatch(/copiada/i);
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas y comprobar que fallan**

Run: `npm test -- tests/extraction-schema.test.ts tests/prompt.test.ts`
Expected: FAIL — no se pueden resolver los dos módulos.

- [ ] **Step 3: Escribir el esquema**

Crear `lib/extraction-schema.ts`:

```typescript
import { z } from "zod";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];

export function isCefrLevel(value: string): value is CefrLevel {
  return (CEFR_LEVELS as readonly string[]).includes(value);
}

export const extractedTermSchema = z.object({
  term: z.string().min(1).describe("El término, verbo frasal o expresión, en inglés"),
  type: z
    .enum(["word", "phrasal_verb", "expression"])
    .describe("word para palabras sueltas, phrasal_verb para verbos frasales, expression para expresiones"),
  translation: z.string().min(1).describe("Traducción al español"),
  context: z.string().min(1).describe("Frase corta copiada literalmente del texto"),
  example: z.string().min(1).describe("Ejemplo práctico de uso, distinto de la frase del texto"),
});

export const extractionSchema = z.object({
  terms: z.array(extractedTermSchema),
});

export type Extraction = z.infer<typeof extractionSchema>;
```

- [ ] **Step 4: Escribir el prompt**

Crear `lib/prompt.ts`:

```typescript
export function buildExtractionPrompt(
  level: string,
  pageStart: number,
  pageEnd: number,
): string {
  return [
    `Analiza las páginas ${pageStart} a ${pageEnd} del PDF adjunto.`,
    "",
    `Extrae exclusivamente el vocabulario, los verbos frasales y las expresiones clave`,
    `que correspondan a un nivel ${level} según el MCER.`,
    "",
    "Reglas obligatorias:",
    `- Cada término debe aparecer literalmente en las páginas adjuntas. No añadas vocabulario que no esté en ellas.`,
    `- "context" debe ser una frase corta copiada literalmente del texto, no redactada por ti.`,
    `- "example" debe ser una frase nueva tuya que muestre el término en uso, distinta de la del texto.`,
    `- La traducción va al español de España.`,
    `- Clasifica cada entrada como word, phrasal_verb o expression.`,
    `- Si en estas páginas no hay nada del nivel ${level}, devuelve una lista vacía.`,
  ].join("\n");
}
```

- [ ] **Step 5: Ejecutar las pruebas y comprobar que pasan**

Run: `npm test -- tests/extraction-schema.test.ts tests/prompt.test.ts`
Expected: PASS, 9 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: esquema de salida estructurada y prompt de extracción"
```

---

### Task 5: Llamada a Claude y cálculo del coste

**Files:**
- Create: `lib/cost.ts`
- Create: `lib/anthropic-extract.ts`
- Create: `tests/fixtures/extraction-response.json`
- Test: `tests/cost.test.ts`
- Test: `tests/anthropic-extract.test.ts`

**Interfaces:**
- Consumes: `extractionSchema`, `buildExtractionPrompt` (tarea 4), `ExtractedTerm` (tarea 3).
- Produces:
  - `estimateCostUsd(usage: { input_tokens: number; output_tokens: number }): number`
  - `extractTermsFromPdf(params: { pdfBase64: string; level: string; pageStart: number; pageEnd: number }): Promise<{ items: ExtractedTerm[]; inputTokens: number; outputTokens: number; costUsd: number }>`
    Lo consume la tarea 7.

- [ ] **Step 1: Escribir la prueba del coste**

Crear `tests/cost.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "@/lib/cost";

describe("estimateCostUsd", () => {
  it("cobra 5 $ por millón de tokens de entrada", () => {
    expect(estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(5);
  });

  it("cobra 25 $ por millón de tokens de salida", () => {
    expect(estimateCostUsd({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(25);
  });

  it("suma entrada y salida", () => {
    expect(estimateCostUsd({ input_tokens: 20_000, output_tokens: 4_000 })).toBeCloseTo(0.2);
  });

  it("devuelve cero sin consumo", () => {
    expect(estimateCostUsd({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test -- tests/cost.test.ts`
Expected: FAIL — no se puede resolver `@/lib/cost`.

- [ ] **Step 3: Implementar el coste**

Crear `lib/cost.ts`:

```typescript
/** Precios de claude-opus-5, en dólares por token. */
const INPUT_USD_PER_TOKEN = 5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;

export function estimateCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
}): number {
  return usage.input_tokens * INPUT_USD_PER_TOKEN + usage.output_tokens * OUTPUT_USD_PER_TOKEN;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/cost.test.ts`
Expected: PASS, 4 pruebas.

- [ ] **Step 5: Crear la respuesta grabada**

Crear `tests/fixtures/extraction-response.json`:

```json
{
  "terms": [
    {
      "term": "come across",
      "type": "phrasal_verb",
      "translation": "encontrarse con",
      "context": "I came across an old photo of my grandmother.",
      "example": "She came across an interesting article about climate change."
    },
    {
      "term": "reluctant",
      "type": "word",
      "translation": "reacio",
      "context": "He was reluctant to speak in public.",
      "example": "I was reluctant to accept the offer at first."
    },
    {
      "term": "under the weather",
      "type": "expression",
      "translation": "pachucho, indispuesto",
      "context": "She's feeling a bit under the weather today.",
      "example": "I stayed home because I was under the weather."
    }
  ]
}
```

- [ ] **Step 6: Escribir la prueba de la llamada, con el SDK simulado**

Crear `tests/anthropic-extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "@/tests/fixtures/extraction-response.json";

const parse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse };
  },
}));

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: (schema: unknown) => ({ schema }),
}));

import { extractTermsFromPdf } from "@/lib/anthropic-extract";

const okResponse = {
  stop_reason: "end_turn",
  parsed_output: fixture,
  usage: { input_tokens: 20_000, output_tokens: 4_000 },
};

const params = { pdfBase64: "JVBERi0=", level: "B2", pageStart: 12, pageEnd: 16 };

describe("extractTermsFromPdf", () => {
  beforeEach(() => parse.mockReset());

  it("devuelve los términos de la respuesta", async () => {
    parse.mockResolvedValue(okResponse);
    const result = await extractTermsFromPdf(params);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].term).toBe("come across");
  });

  it("calcula el coste a partir del consumo", async () => {
    parse.mockResolvedValue(okResponse);
    const result = await extractTermsFromPdf(params);
    expect(result.costUsd).toBeCloseTo(0.2);
    expect(result.inputTokens).toBe(20_000);
  });

  it("envía el PDF como documento antes del texto", async () => {
    parse.mockResolvedValue(okResponse);
    await extractTermsFromPdf(params);
    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe("document");
    expect(content[0].source.media_type).toBe("application/pdf");
    expect(content[0].source.data).toBe("JVBERi0=");
    expect(content[1].type).toBe("text");
  });

  it("usa claude-opus-5", async () => {
    parse.mockResolvedValue(okResponse);
    await extractTermsFromPdf(params);
    expect(parse.mock.calls[0][0].model).toBe("claude-opus-5");
  });

  it("falla con un mensaje claro si la respuesta no se pudo validar", async () => {
    parse.mockResolvedValue({ ...okResponse, parsed_output: null });
    await expect(extractTermsFromPdf(params)).rejects.toThrow(/no devolvió un resultado válido/i);
  });

  it("falla con un mensaje claro si el modelo rechaza la petición", async () => {
    parse.mockResolvedValue({ ...okResponse, stop_reason: "refusal" });
    await expect(extractTermsFromPdf(params)).rejects.toThrow(/rechazó/i);
  });
});
```

- [ ] **Step 7: Ejecutar y comprobar que falla**

Run: `npm test -- tests/anthropic-extract.test.ts`
Expected: FAIL — no se puede resolver `@/lib/anthropic-extract`.

- [ ] **Step 8: Implementar la llamada**

Crear `lib/anthropic-extract.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema } from "@/lib/extraction-schema";
import { buildExtractionPrompt } from "@/lib/prompt";
import { estimateCostUsd } from "@/lib/cost";
import type { ExtractedTerm } from "@/db/repository/extraction";

export type ExtractionOutcome = {
  items: ExtractedTerm[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export async function extractTermsFromPdf(params: {
  pdfBase64: string;
  level: string;
  pageStart: number;
  pageEnd: number;
}): Promise<ExtractionOutcome> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: params.pdfBase64,
            },
          },
          {
            type: "text",
            text: buildExtractionPrompt(params.level, params.pageStart, params.pageEnd),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(extractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("El modelo rechazó la petición para estas páginas.");
  }

  if (!response.parsed_output) {
    throw new Error("El modelo no devolvió un resultado válido para estas páginas.");
  }

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };

  return {
    items: response.parsed_output.terms,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: estimateCostUsd(usage),
  };
}
```

- [ ] **Step 9: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/anthropic-extract.test.ts`
Expected: PASS, 6 pruebas. Ninguna llama a la API real.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: extracción con claude-opus-5 y cálculo del coste real"
```

---

### Task 6: Entrada con contraseña

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/login/route.ts`
- Create: `app/login/page.tsx`
- Create: `middleware.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `createSessionToken(secret: string, expiresAt: number): string`
  - `verifySessionToken(token: string, secret: string, now?: number): boolean`
  - `SESSION_COOKIE = "appvocab_session"`
    Los consumen `middleware.ts` y la tarea 7.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

const SECRET = "secreto-de-prueba";
const HOUR = 60 * 60 * 1000;

describe("sesión", () => {
  it("acepta un token recién creado", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    expect(verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rechaza un token caducado", () => {
    const token = createSessionToken(SECRET, Date.now() - 1);
    expect(verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rechaza un token firmado con otro secreto", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    expect(verifySessionToken(token, "otro-secreto")).toBe(false);
  });

  it("rechaza un token manipulado", () => {
    const token = createSessionToken(SECRET, Date.now() + HOUR);
    const [expiry, signature] = token.split(".");
    const manipulado = `${Number(expiry) + HOUR}.${signature}`;
    expect(verifySessionToken(manipulado, SECRET)).toBe(false);
  });

  it("rechaza basura", () => {
    expect(verifySessionToken("", SECRET)).toBe(false);
    expect(verifySessionToken("no-es-un-token", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test -- tests/auth.test.ts`
Expected: FAIL — no se puede resolver `@/lib/auth`.

- [ ] **Step 3: Implementar la firma de sesión**

Crear `lib/auth.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "appvocab_session";

/** Duración de la sesión: 180 días. Es una app de un solo usuario en su propio móvil. */
export const SESSION_DURATION_MS = 180 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken(secret: string, expiresAt: number): string {
  const payload = String(expiresAt);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload, secret);
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/auth.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Crear la ruta de entrada**

Crear `app/api/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };

  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  const token = createSessionToken(
    process.env.SESSION_SECRET as string,
    Date.now() + SESSION_DURATION_MS,
  );

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
  return response;
}
```

- [ ] **Step 6: Crear el middleware de protección**

Crear `middleware.ts` en la raíz:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (verifySessionToken(token, process.env.SESSION_SECRET as string)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)"],
};
```

- [ ] **Step 7: Crear la pantalla de entrada**

Crear `app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
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
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">AppVocabulario</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Contraseña"
          className="rounded border p-3"
          autoFocus
        />
        <button type="submit" className="rounded bg-black p-3 text-white">
          Entrar
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Comprobar manualmente**

```bash
printf 'APP_PASSWORD=prueba\nSESSION_SECRET=secreto-local-largo\n' >> .env.local
npm run dev
```

Abrir `http://localhost:3000/extraer`: debe redirigir a `/login`. Con la contraseña `prueba` debe dejar pasar; con otra debe mostrar el error.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: entrada con contraseña única y protección de rutas"
```

---

### Task 7: Endpoint de extracción de un lote

**Files:**
- Create: `db/client.ts`
- Create: `app/api/extract/route.ts`
- Test: `tests/api/extract.test.ts`

**Interfaces:**
- Consumes: `extractTermsFromPdf` (tarea 5), `saveExtraction` (tarea 3), `isCefrLevel` (tarea 4).
- Produces: `POST /api/extract` con cuerpo
  `{ pdfBase64: string; title: string; pageStart: number; pageEnd: number; level: string }`
  y respuesta `{ items: ExtractedTerm[]; created: number; merged: number; costUsd: number }`.
  Lo consume la tarea 9.

- [ ] **Step 1: Crear la conexión de producción**

Crear `db/client.ts`:

```typescript
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";

let pool: Pool | undefined;

/** Conexión perezosa: el módulo se puede importar en pruebas sin DATABASE_URL. */
export function getDb() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return drizzle(pool, { schema });
}
```

Se usa el driver por websocket, no el HTTP, porque `saveExtraction` necesita transacciones.

- [ ] **Step 2: Escribir las pruebas que fallan**

Crear `tests/api/extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "@/tests/fixtures/extraction-response.json";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { terms } from "@/db/schema";

const extractTermsFromPdf = vi.fn();
let testDb: TestDb;

vi.mock("@/lib/anthropic-extract", () => ({ extractTermsFromPdf }));
vi.mock("@/db/client", () => ({ getDb: () => testDb }));

import { POST } from "@/app/api/extract/route";

function request(body: unknown) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  pdfBase64: "JVBERi0=",
  title: "Cambridge B2 First",
  pageStart: 12,
  pageEnd: 16,
  level: "B2",
};

describe("POST /api/extract", () => {
  beforeEach(async () => {
    extractTermsFromPdf.mockReset();
    testDb = (await createTestDb()).db;
  });

  it("extrae y guarda los términos del lote", async () => {
    extractTermsFromPdf.mockResolvedValue({
      items: fixture.terms,
      inputTokens: 20_000,
      outputTokens: 4_000,
      costUsd: 0.2,
    });

    const response = await POST(request(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(3);
    expect(body.merged).toBe(0);
    expect(body.costUsd).toBeCloseTo(0.2);
    expect(await testDb.select().from(terms)).toHaveLength(3);
  });

  it("rechaza un nivel que no es del MCER", async () => {
    const response = await POST(request({ ...validBody, level: "B3" }));
    expect(response.status).toBe(400);
    expect(extractTermsFromPdf).not.toHaveBeenCalled();
  });

  it("rechaza un rango de páginas invertido", async () => {
    const response = await POST(request({ ...validBody, pageStart: 20, pageEnd: 12 }));
    expect(response.status).toBe(400);
    expect(extractTermsFromPdf).not.toHaveBeenCalled();
  });

  it("rechaza una petición sin PDF", async () => {
    const response = await POST(request({ ...validBody, pdfBase64: "" }));
    expect(response.status).toBe(400);
  });

  it("devuelve 502 y un mensaje legible si la API falla", async () => {
    extractTermsFromPdf.mockRejectedValue(new Error("connection reset"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/no se pudo extraer/i);
  });

  it("acepta un lote sin ningún término del nivel pedido", async () => {
    extractTermsFromPdf.mockResolvedValue({
      items: [],
      inputTokens: 5_000,
      outputTokens: 20,
      costUsd: 0.025,
    });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
  });
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `npm test -- tests/api/extract.test.ts`
Expected: FAIL — no se puede resolver `@/app/api/extract/route`.

- [ ] **Step 4: Implementar la ruta**

Crear `app/api/extract/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { isCefrLevel } from "@/lib/extraction-schema";
import { extractTermsFromPdf } from "@/lib/anthropic-extract";
import { saveExtraction } from "@/db/repository/extraction";
import { getDb } from "@/db/client";

export const maxDuration = 60;

type Body = {
  pdfBase64?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  level?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const { pdfBase64, title, pageStart, pageEnd, level } = body;

  if (!pdfBase64) {
    return NextResponse.json({ error: "Falta el PDF." }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: "Falta el título de la fuente." }, { status: 400 });
  }
  if (!level || !isCefrLevel(level)) {
    return NextResponse.json({ error: "Nivel del MCER no válido." }, { status: 400 });
  }
  if (
    !Number.isInteger(pageStart) ||
    !Number.isInteger(pageEnd) ||
    (pageStart as number) < 1 ||
    (pageEnd as number) < (pageStart as number)
  ) {
    return NextResponse.json({ error: "Rango de páginas no válido." }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await extractTermsFromPdf({
      pdfBase64,
      level,
      pageStart: pageStart as number,
      pageEnd: pageEnd as number,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No se pudo extraer el vocabulario de estas páginas: ${detail}` },
      { status: 502 },
    );
  }

  const saved = await saveExtraction(getDb(), {
    title: title.trim(),
    pageStart: pageStart as number,
    pageEnd: pageEnd as number,
    level,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    costUsd: outcome.costUsd,
    items: outcome.items,
  });

  return NextResponse.json({
    items: outcome.items,
    created: saved.created,
    merged: saved.merged,
    costUsd: outcome.costUsd,
  });
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/api/extract.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: endpoint de extracción de un lote con validación y guardado"
```

---

### Task 8: Recorte del PDF y planificación de lotes

**Files:**
- Create: `lib/pdf-slice.ts`
- Test: `tests/pdf-slice.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `planBatches(pageStart: number, pageEnd: number, size?: number): Array<{ pageStart: number; pageEnd: number }>`
  - `slicePdf(bytes: Uint8Array, pageStart: number, pageEnd: number): Promise<Uint8Array>`
  - `toBase64(bytes: Uint8Array): string`
    Los consume la tarea 9.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/pdf-slice.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { planBatches, slicePdf } from "@/lib/pdf-slice";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([200, 200]);
  }
  return doc.save();
}

describe("planBatches", () => {
  it("agrupa de cinco en cinco", () => {
    expect(planBatches(1, 10)).toEqual([
      { pageStart: 1, pageEnd: 5 },
      { pageStart: 6, pageEnd: 10 },
    ]);
  });

  it("deja el último lote incompleto", () => {
    expect(planBatches(12, 18)).toEqual([
      { pageStart: 12, pageEnd: 16 },
      { pageStart: 17, pageEnd: 18 },
    ]);
  });

  it("devuelve un solo lote para una página", () => {
    expect(planBatches(7, 7)).toEqual([{ pageStart: 7, pageEnd: 7 }]);
  });

  it("rechaza un rango invertido", () => {
    expect(() => planBatches(9, 3)).toThrow();
  });
});

describe("slicePdf", () => {
  it("extrae exactamente las páginas pedidas", async () => {
    const sliced = await slicePdf(await makePdf(10), 3, 6);
    const doc = await PDFDocument.load(sliced);
    expect(doc.getPageCount()).toBe(4);
  });

  it("acepta la primera y la última página", async () => {
    const original = await makePdf(10);
    expect((await PDFDocument.load(await slicePdf(original, 1, 1))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await slicePdf(original, 10, 10))).getPageCount()).toBe(1);
  });

  it("falla si el rango se sale del documento", async () => {
    await expect(slicePdf(await makePdf(10), 8, 12)).rejects.toThrow(/10 páginas/);
  });

  it("falla si la página inicial no existe", async () => {
    await expect(slicePdf(await makePdf(10), 0, 3)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test -- tests/pdf-slice.test.ts`
Expected: FAIL — no se puede resolver `@/lib/pdf-slice`.

- [ ] **Step 3: Implementar**

Crear `lib/pdf-slice.ts`:

```typescript
import { PDFDocument } from "pdf-lib";

export const BATCH_SIZE = 5;

export function planBatches(
  pageStart: number,
  pageEnd: number,
  size: number = BATCH_SIZE,
): Array<{ pageStart: number; pageEnd: number }> {
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1) {
    throw new Error("El rango de páginas no es válido.");
  }
  if (pageEnd < pageStart) {
    throw new Error("La página final no puede ser anterior a la inicial.");
  }

  const batches: Array<{ pageStart: number; pageEnd: number }> = [];
  for (let start = pageStart; start <= pageEnd; start += size) {
    batches.push({ pageStart: start, pageEnd: Math.min(start + size - 1, pageEnd) });
  }
  return batches;
}

/** Devuelve un PDF nuevo con solo el rango pedido. Las páginas se cuentan desde 1. */
export async function slicePdf(
  bytes: Uint8Array,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();

  if (pageStart < 1 || pageEnd < pageStart) {
    throw new Error("El rango de páginas no es válido.");
  }
  if (pageEnd > total) {
    throw new Error(`El PDF tiene ${total} páginas y has pedido hasta la ${pageEnd}.`);
  }

  const target = await PDFDocument.create();
  const indices = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart - 1 + i);
  const copied = await target.copyPages(source, indices);
  for (const page of copied) {
    target.addPage(page);
  }
  return target.save();
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/pdf-slice.test.ts`
Expected: PASS, 8 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: recorte de páginas del PDF y planificación de lotes"
```

---

### Task 9: Orquestación de la extracción y pantalla

**Files:**
- Create: `lib/run-extraction.ts`
- Create: `components/ExtractForm.tsx`
- Create: `app/extraer/page.tsx`
- Test: `tests/run-extraction.test.ts`

**Interfaces:**
- Consumes: `planBatches`, `slicePdf`, `toBase64` (tarea 8), `POST /api/extract` (tarea 7).
- Produces: `runExtraction(input, callbacks): Promise<RunSummary>` con
  `RunSummary = { created: number; merged: number; costUsd: number; failed: Array<{ pageStart: number; pageEnd: number; error: string }> }`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/run-extraction.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { runExtraction } from "@/lib/run-extraction";

async function makePdfBytes(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

const okBatch = { items: [], created: 2, merged: 1, costUsd: 0.05 };

describe("runExtraction", () => {
  it("envía un lote por cada cinco páginas, en orden", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0].pageStart).toBe(1);
    expect(post.mock.calls[0][0].pageEnd).toBe(5);
    expect(post.mock.calls[1][0].pageStart).toBe(6);
  });

  it("suma lo creado, lo fusionado y el coste de todos los lotes", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    const summary = await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post },
    );

    expect(summary.created).toBe(4);
    expect(summary.merged).toBe(2);
    expect(summary.costUsd).toBeCloseTo(0.1);
    expect(summary.failed).toHaveLength(0);
  });

  it("sigue con los siguientes lotes cuando uno falla y lo registra", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(okBatch)
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce(okBatch);

    const summary = await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 15, level: "B2" },
      { post },
    );

    expect(post).toHaveBeenCalledTimes(3);
    expect(summary.created).toBe(4);
    expect(summary.failed).toEqual([{ pageStart: 6, pageEnd: 10, error: "502" }]);
  });

  it("avisa del progreso después de cada lote", async () => {
    const post = vi.fn().mockResolvedValue(okBatch);
    const onProgress = vi.fn();
    await runExtraction(
      { bytes: await makePdfBytes(20), title: "Libro", pageStart: 1, pageEnd: 10, level: "B2" },
      { post, onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test -- tests/run-extraction.test.ts`
Expected: FAIL — no se puede resolver `@/lib/run-extraction`.

- [ ] **Step 3: Implementar el orquestador**

Crear `lib/run-extraction.ts`:

```typescript
import { planBatches, slicePdf, toBase64 } from "@/lib/pdf-slice";

export type BatchResponse = {
  items: unknown[];
  created: number;
  merged: number;
  costUsd: number;
};

export type RunInput = {
  bytes: Uint8Array;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
};

export type RunSummary = {
  created: number;
  merged: number;
  costUsd: number;
  failed: Array<{ pageStart: number; pageEnd: number; error: string }>;
};

export type PostBatchBody = {
  pdfBase64: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: string;
};

export type RunCallbacks = {
  post: (body: PostBatchBody) => Promise<BatchResponse>;
  onProgress?: (progress: { done: number; total: number }) => void;
};

/**
 * Recorre el rango en lotes, en secuencia. Cada lote que responde ya está guardado
 * en el servidor: un fallo posterior no deshace lo anterior.
 */
export async function runExtraction(
  input: RunInput,
  callbacks: RunCallbacks,
): Promise<RunSummary> {
  const batches = planBatches(input.pageStart, input.pageEnd);
  const summary: RunSummary = { created: 0, merged: 0, costUsd: 0, failed: [] };

  for (const [index, batch] of batches.entries()) {
    try {
      const sliced = await slicePdf(input.bytes, batch.pageStart, batch.pageEnd);
      const result = await callbacks.post({
        pdfBase64: toBase64(sliced),
        title: input.title,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        level: input.level,
      });
      summary.created += result.created;
      summary.merged += result.merged;
      summary.costUsd += result.costUsd;
    } catch (error) {
      summary.failed.push({
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        error: error instanceof Error ? error.message : "error desconocido",
      });
    }
    callbacks.onProgress?.({ done: index + 1, total: batches.length });
  }

  return summary;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/run-extraction.test.ts`
Expected: PASS, 4 pruebas.

- [ ] **Step 5: Crear el formulario**

Crear `components/ExtractForm.tsx`:

```tsx
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
```

- [ ] **Step 6: Crear la página**

Crear `app/extraer/page.tsx`:

```tsx
import Link from "next/link";
import { ExtractForm } from "@/components/ExtractForm";

export default function ExtraerPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Extraer vocabulario</h1>
        <Link href="/biblioteca" className="underline">
          Biblioteca
        </Link>
      </header>
      <ExtractForm />
    </main>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: pantalla de extracción con lotes en secuencia y progreso"
```

---

### Task 10: Biblioteca editable

**Files:**
- Create: `db/repository/terms.ts`
- Create: `app/api/terms/route.ts`
- Create: `app/api/terms/[id]/route.ts`
- Create: `components/TermTable.tsx`
- Create: `app/biblioteca/page.tsx`
- Test: `tests/db/terms.test.ts`

**Interfaces:**
- Consumes: esquema (tarea 2), `getDb` (tarea 7).
- Produces:
  - `listTerms(db, filters: { level?: string; type?: string; search?: string }): Promise<TermRow[]>`
  - `updateTerm(db, id: number, fields: { term?: string; translation?: string; type?: string; level?: string }): Promise<void>`
  - `deleteTerm(db, id: number): Promise<void>`
  con `TermRow = { id: number; term: string; type: string; translation: string; level: string; contexts: string[]; examples: string[] }`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/db/terms.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { listTerms, updateTerm, deleteTerm } from "@/db/repository/terms";
import { cardStates, termOccurrences } from "@/db/schema";

let db: TestDb;

const base = {
  title: "Libro",
  pageStart: 1,
  pageEnd: 5,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

beforeEach(async () => {
  db = (await createTestDb()).db;
  await saveExtraction(db, {
    ...base,
    level: "B2",
    items: [
      {
        term: "come across",
        type: "phrasal_verb",
        translation: "encontrarse con",
        context: "I came across a photo.",
        example: "She came across an article.",
      },
      {
        term: "reluctant",
        type: "word",
        translation: "reacio",
        context: "He was reluctant to speak.",
        example: "I was reluctant to accept.",
      },
    ],
  });
});

describe("listTerms", () => {
  it("devuelve todos los términos con sus contextos", async () => {
    const rows = await listTerms(db, {});
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.term === "come across")?.contexts).toEqual([
      "I came across a photo.",
    ]);
  });

  it("filtra por tipo", async () => {
    const rows = await listTerms(db, { type: "phrasal_verb" });
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe("come across");
  });

  it("filtra por nivel", async () => {
    expect(await listTerms(db, { level: "B2" })).toHaveLength(2);
    expect(await listTerms(db, { level: "A1" })).toHaveLength(0);
  });

  it("busca por texto, sin distinguir mayúsculas", async () => {
    const rows = await listTerms(db, { search: "RELUCT" });
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe("reluctant");
  });
});

describe("updateTerm", () => {
  it("cambia la traducción sin tocar el estado de repaso", async () => {
    const [row] = await listTerms(db, { type: "word" });
    const before = await db.select().from(cardStates);
    await updateTerm(db, row.id, { translation: "remiso" });

    const [after] = await listTerms(db, { type: "word" });
    expect(after.translation).toBe("remiso");
    expect(await db.select().from(cardStates)).toEqual(before);
  });
});

describe("deleteTerm", () => {
  it("borra el término, su tarjeta y sus apariciones", async () => {
    const [row] = await listTerms(db, { type: "word" });
    await deleteTerm(db, row.id);

    expect(await listTerms(db, {})).toHaveLength(1);
    expect(await db.select().from(cardStates)).toHaveLength(1);
    expect(await db.select().from(termOccurrences)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npm test -- tests/db/terms.test.ts`
Expected: FAIL — no se puede resolver `@/db/repository/terms`.

- [ ] **Step 3: Implementar el repositorio**

Crear `db/repository/terms.ts`:

```typescript
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { terms, termOccurrences } from "@/db/schema";
import type { Database } from "@/db/types";

export type TermRow = {
  id: number;
  term: string;
  type: string;
  translation: string;
  level: string;
  contexts: string[];
  examples: string[];
};

export async function listTerms(
  db: Database,
  filters: { level?: string; type?: string; search?: string },
): Promise<TermRow[]> {
  const conditions: SQL[] = [];
  if (filters.level) conditions.push(eq(terms.level, filters.level));
  if (filters.type) conditions.push(eq(terms.type, filters.type));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(ilike(terms.term, pattern), ilike(terms.translation, pattern)) as SQL,
    );
  }

  const rows = await db
    .select({
      id: terms.id,
      term: terms.term,
      type: terms.type,
      translation: terms.translation,
      level: terms.level,
      context: termOccurrences.context,
      example: termOccurrences.example,
    })
    .from(terms)
    .leftJoin(termOccurrences, eq(termOccurrences.termId, terms.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const byId = new Map<number, TermRow>();
  for (const row of rows) {
    const current = byId.get(row.id) ?? {
      id: row.id,
      term: row.term,
      type: row.type,
      translation: row.translation,
      level: row.level,
      contexts: [],
      examples: [],
    };
    if (row.context) current.contexts.push(row.context);
    if (row.example) current.examples.push(row.example);
    byId.set(row.id, current);
  }
  return [...byId.values()];
}

export async function updateTerm(
  db: Database,
  id: number,
  fields: { term?: string; translation?: string; type?: string; level?: string },
): Promise<void> {
  await db
    .update(terms)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(terms.id, id));
}

/** Borra el término; la tarjeta y las apariciones caen con él por clave foránea. */
export async function deleteTerm(db: Database, id: number): Promise<void> {
  await db.delete(terms).where(eq(terms.id, id));
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npm test -- tests/db/terms.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 5: Crear las rutas de la biblioteca**

Crear `app/api/terms/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listTerms } from "@/db/repository/terms";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await listTerms(getDb(), {
    level: url.searchParams.get("level") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  return NextResponse.json({ terms: rows });
}
```

Crear `app/api/terms/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { updateTerm, deleteTerm } from "@/db/repository/terms";
import { getDb } from "@/db/client";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const fields = (await request.json()) as {
    term?: string;
    translation?: string;
    type?: string;
    level?: string;
  };
  await updateTerm(getDb(), Number(id), fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  await deleteTerm(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Crear la tabla editable**

Crear `components/TermTable.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { TermRow } from "@/db/repository/terms";

export function TermTable() {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const response = await fetch(`/api/terms${query}`);
    const body = (await response.json()) as { terms: TermRow[] };
    setRows(body.terms);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    </div>
  );
}
```

Crear `app/biblioteca/page.tsx`:

```tsx
import Link from "next/link";
import { TermTable } from "@/components/TermTable";

export default function BibliotecaPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca</h1>
        <Link href="/extraer" className="underline">
          Extraer
        </Link>
      </header>
      <TermTable />
    </main>
  );
}
```

- [ ] **Step 7: Ejecutar toda la batería de pruebas**

Run: `npm test`
Expected: PASS, todas las pruebas de las tareas 1 a 10.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: biblioteca con búsqueda, edición y borrado"
```

---

### Task 11: Despliegue y prueba con un PDF real

**Files:**
- Create: `.env.example`
- Create: `README.md`
- Modify: `app/page.tsx` (redirigir a `/extraer`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la aplicación desplegada y verificada con material real.

- [ ] **Step 1: Redirigir la portada**

Sustituir el contenido de `app/page.tsx` por:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/extraer");
}
```

- [ ] **Step 2: Documentar las variables de entorno**

Crear `.env.example`:

```bash
# Clave de la API de Anthropic
ANTHROPIC_API_KEY=

# Cadena de conexión de Postgres en Neon
DATABASE_URL=

# Contraseña única para entrar en la app
APP_PASSWORD=

# Secreto para firmar la cookie de sesión (cadena larga y aleatoria)
SESSION_SECRET=
```

- [ ] **Step 3: Escribir el README**

Crear `README.md`:

````markdown
# AppVocabulario

Extrae vocabulario en inglés de un PDF con la API de Claude y lo guarda para
repasarlo. Aplicación de un solo usuario.

Diseño: `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`

## En local

```bash
npm install
cp .env.example .env.local   # y rellenar las cuatro variables
npx drizzle-kit push         # crea las tablas
npm run dev                  # http://localhost:3000
```

## Pruebas

```bash
npm test
```

Ninguna prueba llama a la API de Claude ni toca la base de datos real: usan
respuestas grabadas y un Postgres en memoria.

## Despliegue en Vercel

1. Crear una base de datos gratuita en Neon y copiar su cadena de conexión.
2. Importar este repositorio en Vercel.
3. Definir las cuatro variables de `.env.example` en el proyecto de Vercel.
   `SESSION_SECRET` debe ser una cadena larga y aleatoria; `APP_PASSWORD` es la
   contraseña con la que se entra.
4. Aplicar las migraciones contra la base de producción:
   `DATABASE_URL='...' npx drizzle-kit push`
5. Desplegar.

## Coste

Cada extracción muestra su coste real. El modelo es `claude-opus-5`: 5 $ por
millón de tokens de entrada y 25 $ por millón de salida.
````

- [ ] **Step 4: Crear la base de datos y desplegar**

```bash
npx drizzle-kit push
```

Después: crear el proyecto en Vercel, definir las cuatro variables de entorno y desplegar.

- [ ] **Step 5: Prueba de aceptación con un PDF real**

Esta prueba la hace el usuario, no un agente. La fase 1 no está terminada hasta que pase:

1. Entrar en la app desplegada con la contraseña.
2. Subir un PDF propio y pedir un rango corto con su nivel del MCER.
3. Comprobar que el vocabulario extraído es correcto y útil: los términos aparecen de verdad en esas páginas y las traducciones son correctas.
4. Comprobar que el coste mostrado es asumible.
5. Editar una traducción en la biblioteca.
6. Cerrar la app, volver a abrirla y comprobar que todo sigue ahí, con la corrección incluida.
7. Repetir la extracción del mismo rango y comprobar que los términos salen como "ya los tenías" y que la corrección no se ha perdido.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: portada, variables de entorno y documentación de despliegue"
```
