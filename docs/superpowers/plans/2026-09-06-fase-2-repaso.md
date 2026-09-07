# AppVocabulario — Fase 2: repaso espaciado y rediseño

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la biblioteca de vocabulario en aprendizaje real: sesiones diarias de repetición espaciada con FSRS, sobre una interfaz rediseñada, moderna y usable con una mano en el móvil.

**Architecture:** Se añade `ts-fsrs` y dos rutas (`GET /api/repaso/cola`, `POST /api/repaso/respuesta`). El navegador recibe la cola del día completa, de modo que responder es instantáneo, y envía cada valoración en cuanto se pulsa, con reintento. El servidor es la única autoridad: ejecuta FSRS, actualiza `card_states` y registra en `review_logs`. Cada respuesta lleva un identificador único y las repetidas se ignoran. En paralelo se define un sistema visual propio y se aplica a las cuatro pantallas.

**Tech Stack:** Next.js (App Router) · TypeScript · Tailwind · Drizzle + Postgres (Neon) · `ts-fsrs` 5.4.2 · Vitest · PGlite

**Spec:** `docs/superpowers/specs/2026-09-06-fase-2-repaso-design.md`
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`

## Global Constraints

- **Esta fase no consume API de Claude.** Ninguna tarea llama a Anthropic. Si una lo necesita, el plan está mal.
- **`ts-fsrs` versión 5.4.2**, ya verificada contra la implementación real (ver "Hechos verificados").
- **El servidor calcula FSRS.** El cliente envía solo qué botón se pulsó. El cliente nunca escribe fechas ni estados.
- **Toda respuesta es idempotente:** identificador único por respuesta; una repetida no se aplica dos veces.
- **Tope de tarjetas nuevas al día:** 20 por defecto, guardado en base de datos, no en el navegador.
- **Nunca se regenera `card_states` ni `review_logs`.** Llevan datos reales desde la primera extracción.
- **Idioma de la interfaz:** español. El contenido de las tarjetas es inglés-español.
- **Las pruebas no llaman a ninguna API ni tocan una base de datos real** (PGlite con las migraciones reales).
- **Sin conexión no se soporta**, a propósito.
- **Sin rachas, sin logros, sin notificaciones.**
- El estado actual antes de empezar: 98 pruebas en verde, `tsc --noEmit` limpio, `eslint .` sin ningún problema. Mantenerlo así.

## Hechos verificados de `ts-fsrs` 5.4.2

Comprobados ejecutando la librería, no de memoria. Úsalos tal cual:

```js
import { fsrs, createEmptyCard, Rating, State } from "ts-fsrs";

const f = fsrs();                      // programador con parámetros por defecto
f.next(card, now, Rating.Good);        // -> { card, log }   una sola valoración
f.repeat(card, now);                   // -> { 1: {card,log}, 2: ..., 3: ..., 4: ... }
```

- `Rating`: `Again = 1`, `Hard = 2`, `Good = 3`, `Easy = 4` (y `Manual = 0`, sin usar aquí).
- `State`: `New = 0`, `Learning = 1`, `Review = 2`, `Relearning = 3`.
- Una `Card` tiene exactamente: `due`, `stability`, `difficulty`, `elapsed_days`,
  `scheduled_days`, `reps`, `lapses`, **`learning_steps`**, `state`, y `last_review`.
  **Corrección (2026-09-07):** el plan decía que `last_review` estaba *ausente* en una
  tarjeta nueva. Es falso, comprobado ejecutando `createEmptyCard`: la clave existe
  siempre, con valor `undefined`. `Object.keys` la devuelve. Usa `=== undefined`, nunca
  `in` ni `hasOwnProperty`. `due` es un objeto `Date`; `last_review` lo es cuando existe.
- **`learning_steps` NO existe en `card_states`.** Hay que añadirla (tarea 2).
- Plazos reales de una tarjeta nueva: Again +1 min, Hard +6 min, Good +10 min,
  Easy +8 días. De una madura (stability 120): Again mismo día, Hard +230 días,
  Good +303 días, Easy +463 días. **Nunca escribas estos números a mano en la
  interfaz: calcúlalos con `f.repeat`.**

## Sistema visual

Estos valores son la fuente de verdad del diseño. Se definen una vez (tarea 1) y
todo lo demás los consume; ninguna pantalla inventa un color ni un tamaño.

**Dirección:** editorial y cálida, con un acento vivo. La frase en inglés es el
contenido protagonista y va en serif; la interfaz, en grotesca. Nada de degradados
morados, nada de mascotas.

**Tipografías** (Google Fonts, cargadas con `next/font/google`):
- `Fraunces` — el término y su frase de contexto. Serif variable con carácter.
- `Bricolage Grotesque` — toda la interfaz: botones, campos, etiquetas.

**Color:**

| Token | Claro | Oscuro |
|---|---|---|
| `--fondo` | `#FBF7F1` | `#141210` |
| `--superficie` | `#FFFFFF` | `#1E1B18` |
| `--texto` | `#191512` | `#F3EDE5` |
| `--texto-suave` | `#6B6259` | `#A79C90` |
| `--borde` | `#E5DCD1` | `#332E29` |
| `--acento` | `#E1552C` | `#FF7A4D` |

**Botones de valoración** (mismo color en ambos temas, el texto siempre blanco):

| Botón | Color |
|---|---|
| Otra vez | `#D6402F` |
| Difícil | `#C77A16` |
| Bien | `#3E9D62` |
| Fácil | `#3B7FA6` |

**Corrección (2026-09-07):** tres de esos cuatro colores no llegaban a 4,5:1 con
texto blanco y se oscurecieron al aplicarlos. Lo que hay en `app/globals.css`, que
es la fuente de verdad, es:

| Botón | Color del plan | Color real |
|---|---|---|
| Otra vez | `#D6402F` | `#D6402F` (sin cambio) |
| Difícil | `#C77A16` | `#A4620F` |
| Bien | `#3E9D62` | `#2E7D4C` |
| Fácil | `#3B7FA6` | `#37769B` |

Por el mismo motivo hay tres tokens que el plan no preveía: `--acento-solido`
(superficie de relleno del botón primario — `--acento` con texto blanco no llega a
4,5:1, y `--acento` no se toca porque se usa como tinte al 15%),
`--texto-sobre-acento` y `--texto-sobre-valoracion`. Las variantes de `Boton` y los
cuatro botones de valoración leen estos pares, no los colores sueltos.

**Escala tipográfica:** 0.875 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3 rem.
**Espaciado:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px.
**Radios:** 16px tarjetas, 12px botones y campos.
**Áreas táctiles:** mínimo 48px de alto en cualquier control.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `app/globals.css` | Tokens de color, tipografía y espaciado, claro y oscuro |
| `components/ui/Boton.tsx` | Botón base en sus variantes |
| `components/ui/Campo.tsx` | Campo de texto, número y desplegable |
| `components/ui/Tarjeta.tsx` | Contenedor de superficie |
| `db/schema.ts` | Añadir `learning_steps` y la tabla `settings` |
| `db/repository/settings.ts` | Leer y escribir el tope diario |
| `db/repository/review.ts` | Cola del día y aplicación idempotente de respuestas |
| `lib/fsrs.ts` | Puente entre `card_states` y las `Card` de `ts-fsrs` |
| `app/api/repaso/cola/route.ts` | Entrega la cola del día |
| `app/api/repaso/respuesta/route.ts` | Registra una valoración |
| `lib/review-session.ts` | Orquestación en el navegador: avance optimista y reintentos |
| `components/SesionRepaso.tsx` | La pantalla de repaso |
| `app/repaso/page.tsx` | Ruta de la sesión |
| `app/manifest.ts` | Manifiesto PWA |

---

### Task 1: Sistema visual

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `components/ui/Boton.tsx`, `components/ui/Campo.tsx`, `components/ui/Tarjeta.tsx`
- Modify: `app/login/page.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: las variables CSS de la sección "Sistema visual" y tres componentes
  (`Boton`, `Campo`, `Tarjeta`) que consumen las tareas 6, 8, 9 y 10.

**Esta tarea no tiene pruebas automáticas.** El diseño no se verifica con asserts.
Su puerta de calidad son capturas que aprueba el usuario (paso 6). Las 98 pruebas
existentes deben seguir pasando.

- [ ] **Step 1: Cargar las tipografías**

En `app/layout.tsx`, con `next/font/google`: `Fraunces` (variable, subconjunto
`latin`) expuesta como `--fuente-serif`, y `Bricolage_Grotesque` como
`--fuente-ui`. Aplicar `--fuente-ui` al `body`.

- [ ] **Step 2: Definir los tokens**

En `app/globals.css`, declarar en `:root` los seis colores del tema claro de la
tabla "Color", los cuatro de valoración, la escala tipográfica, el espaciado y los
radios. Redefinir **solo los seis que cambian** dentro de
`@media (prefers-color-scheme: dark)`. Los colores de valoración no cambian entre
temas.

Ningún color puede estar definido únicamente dentro del bloque oscuro.

- [ ] **Step 3: Componentes base**

`Boton` con variantes `primario` (fondo acento, texto claro), `secundario` (borde,
fondo transparente) y `peligro`. Altura mínima 48px. Estado deshabilitado visible.
`Campo` para texto, número y desplegable, con etiqueta asociada por `htmlFor`.
`Tarjeta` como superficie con radio 16px y borde.

Ninguno acepta colores por parámetro: todos leen los tokens.

- [ ] **Step 4: Aplicar a la pantalla de entrada**

Rehacer `app/login/page.tsx` con los componentes nuevos. Es la pantalla más simple
y sirve de primera prueba del sistema.

- [ ] **Step 5: Verificar que nada se rompió**

Run: `npm test` → 98 en verde. `npx tsc --noEmit` y `npx eslint .` → limpios.

- [ ] **Step 6: Capturas para aprobación**

Arrancar `npm run dev` y capturar `/login` en **móvil (390px) y escritorio, en
claro y en oscuro**: cuatro capturas. Comprobar contraste de texto ≥ 4.5:1 en
ambos temas. Entregar al usuario y **esperar su aprobación antes de continuar**.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: sistema visual y componentes base"
```

---

### Task 2: Esquema para FSRS y ajustes

**Files:**
- Modify: `db/schema.ts`
- Create: `db/repository/settings.ts`
- Create: `lib/fsrs.ts`
- Test: `tests/db/settings.test.ts`, `tests/fsrs.test.ts`

**Interfaces:**
- Consumes: esquema y `createTestDb` de la fase 1.
- Produces:
  - Columna `learningSteps` en `cardStates`; columna `answerId` única en `reviewLogs`; tabla `settings`.
  - `getNewCardsPerDay(db): Promise<number>` y `setNewCardsPerDay(db, n): Promise<void>`.
  - `toFsrsCard(row): Card` y `fromFsrsCard(card): Partial<CardStateRow>` en `lib/fsrs.ts`.
  Los consumen las tareas 3, 4 y 5.

- [ ] **Step 1: Instalar la librería**

```bash
npm install ts-fsrs@5.4.2
```

- [ ] **Step 2: Ampliar el esquema**

En `db/schema.ts`, añadir a `cardStates`:

```typescript
  learningSteps: integer("learning_steps").notNull().default(0),
```

Añadir a `reviewLogs`, para la idempotencia:

```typescript
  answerId: text("answer_id").notNull(),
```

y su índice único, en el tercer argumento de `pgTable`:

```typescript
  (table) => ({
    answerIdIdx: uniqueIndex("review_logs_answer_id_idx").on(table.answerId),
  }),
```

Y la tabla de ajustes, de una sola fila:

```typescript
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  newCardsPerDay: integer("new_cards_per_day").notNull().default(20),
});
```

**No toques ninguna columna existente ni borres nada.**

- [ ] **Step 3: Generar la migración**

Run: `npx drizzle-kit generate`
Expected: un `.sql` nuevo en `drizzle/` que solo **añade**. Ábrelo y compruébalo:
si contiene `DROP` sobre `card_states` o `review_logs`, para y repórtalo.

- [ ] **Step 4: Escribir las pruebas que fallan**

Crear `tests/fsrs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { toFsrsCard, fromFsrsCard } from "@/lib/fsrs";

const fila = {
  termId: 1,
  due: new Date("2026-09-06T00:00:00Z"),
  stability: 0,
  difficulty: 0,
  elapsedDays: 0,
  scheduledDays: 0,
  reps: 0,
  lapses: 0,
  learningSteps: 0,
  state: 0,
  lastReview: null,
};

describe("puente con ts-fsrs", () => {
  it("convierte una fila en una Card con todos los campos", () => {
    const card = toFsrsCard(fila);
    const vacia = createEmptyCard(new Date("2026-09-06T00:00:00Z"));
    expect(Object.keys(card).sort()).toEqual(
      [...Object.keys(vacia), "last_review"].sort(),
    );
  });

  it("una fila nueva equivale a una tarjeta vacía", () => {
    const card = toFsrsCard(fila);
    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.due.getTime()).toBe(fila.due.getTime());
  });

  it("ida y vuelta sin perder información", () => {
    const now = new Date("2026-09-06T00:00:00Z");
    const { card } = fsrs().next(toFsrsCard(fila), now, Rating.Good);
    const vuelta = toFsrsCard({ ...fila, ...fromFsrsCard(card) });
    expect(vuelta.stability).toBeCloseTo(card.stability);
    expect(vuelta.difficulty).toBeCloseTo(card.difficulty);
    expect(vuelta.learning_steps).toBe(card.learning_steps);
    expect(vuelta.state).toBe(card.state);
    expect(vuelta.due.getTime()).toBe(card.due.getTime());
  });
});
```

Crear `tests/db/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { getNewCardsPerDay, setNewCardsPerDay } from "@/db/repository/settings";

let db: TestDb;
let closeDb: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

describe("ajustes", () => {
  it("sin fila guardada devuelve 20 por defecto", async () => {
    expect(await getNewCardsPerDay(db)).toBe(20);
  });

  it("guarda y recupera un valor nuevo", async () => {
    await setNewCardsPerDay(db, 5);
    expect(await getNewCardsPerDay(db)).toBe(5);
  });

  it("guardar dos veces no crea dos filas", async () => {
    await setNewCardsPerDay(db, 5);
    await setNewCardsPerDay(db, 30);
    expect(await getNewCardsPerDay(db)).toBe(30);
  });

  it("rechaza un tope negativo o no entero", async () => {
    await expect(setNewCardsPerDay(db, -1)).rejects.toThrow();
    await expect(setNewCardsPerDay(db, 2.5)).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Ejecutar y comprobar que fallan**

Run: `npm test -- tests/fsrs.test.ts tests/db/settings.test.ts`
Expected: FAIL — no se pueden resolver `@/lib/fsrs` ni `@/db/repository/settings`.

- [ ] **Step 6: Escribir el puente con FSRS**

Crear `lib/fsrs.ts`:

```typescript
import type { Card } from "ts-fsrs";

/** Una fila de `card_states` tal como la devuelve Drizzle. */
export type CardStateRow = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  state: number;
  lastReview: Date | null;
};

/** Fila -> Card. ts-fsrs usa snake_case; nuestro esquema, camelCase. */
export function toFsrsCard(row: CardStateRow): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    learning_steps: row.learningSteps,
    state: row.state,
    last_review: row.lastReview ?? undefined,
  } as Card;
}

/** Card -> columnas que hay que escribir. */
export function fromFsrsCard(card: Card): Omit<CardStateRow, "termId"> {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}
```

- [ ] **Step 7: Escribir el repositorio de ajustes**

Crear `db/repository/settings.ts`:

```typescript
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Database } from "@/db/types";

const FILA = 1;
export const TOPE_POR_DEFECTO = 20;

export async function getNewCardsPerDay(db: Database): Promise<number> {
  const filas = await db.select().from(settings).where(eq(settings.id, FILA)).limit(1);
  return filas[0]?.newCardsPerDay ?? TOPE_POR_DEFECTO;
}

export async function setNewCardsPerDay(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tope de tarjetas nuevas debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, newCardsPerDay: valor })
    .onConflictDoUpdate({ target: settings.id, set: { newCardsPerDay: valor } });
}
```

- [ ] **Step 8: Ejecutar y comprobar que pasan**

Run: `npm test`
Expected: PASS, 105 pruebas (98 previas + 3 de fsrs + 4 de ajustes).

- [ ] **Step 9: Aplicar la migración a la base real del usuario**

```bash
DATABASE_URL='<cadena de Neon>' npx drizzle-kit push
```

Después, comprobar que **las 44 fichas siguen ahí** con `learning_steps` a 0. Si el
recuento no coincide, para y repórtalo: se han perdido datos.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: esquema para FSRS, ajustes y puente con ts-fsrs"
```

---

### Task 3: La cola del día

**Files:**
- Create: `db/repository/review.ts`
- Test: `tests/db/review-queue.test.ts`

**Interfaces:**
- Consumes: esquema (tarea 2), `getNewCardsPerDay` (tarea 2).
- Produces:
  `getDueQueue(db, opts): Promise<CartaCola[]>` con
  `opts = { now: Date; source?: string; type?: string }` y
  `CartaCola = { termId: number; term: string; translation: string; type: string; level: string; context: string; example: string; esNueva: boolean; plazos: Record<1|2|3|4, string> }`.
  `plazos` trae, ya formateado en español, cuándo volvería a aparecer la tarjeta con
  cada uno de los cuatro botones. Viene del servidor porque **el cliente no calcula
  fechas**. La consumen las tareas 5, 6 y 7.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/db/review-queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay } from "@/db/repository/settings";
import { getDueQueue } from "@/db/repository/review";
import { cardStates } from "@/db/schema";
import { eq } from "drizzle-orm";

let db: TestDb;
let closeDb: () => Promise<void>;
const AHORA = new Date("2026-09-10T09:00:00Z");

const base = {
  title: "Libro A",
  pageStart: 1,
  pageEnd: 5,
  level: "B2",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

function termino(n: number, type = "word") {
  return {
    term: `palabra${n}`,
    type: type as "word" | "phrasal_verb" | "expression",
    translation: `traducción${n}`,
    context: `Frase con palabra${n}.`,
    example: `Ejemplo con palabra${n}.`,
  };
}

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

describe("getDueQueue", () => {
  it("respeta el tope de tarjetas nuevas", async () => {
    await saveExtraction(db, { ...base, items: Array.from({ length: 30 }, (_, i) => termino(i)) });
    await setNewCardsPerDay(db, 20);

    const cola = await getDueQueue(db, { now: AHORA });
    expect(cola).toHaveLength(20);
    expect(cola.every((c) => c.esNueva)).toBe(true);
  });

  it("incluye las vencidas además de las nuevas, sin contarlas en el tope", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2), termino(3)] });
    await setNewCardsPerDay(db, 1);
    // palabra1 pasa a estar vencida: ya no es nueva
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-09-09T09:00:00Z") })
      .where(eq(cardStates.termId, 1));

    const cola = await getDueQueue(db, { now: AHORA });
    expect(cola.filter((c) => !c.esNueva)).toHaveLength(1);
    expect(cola.filter((c) => c.esNueva)).toHaveLength(1);
  });

  it("excluye lo que aún no vence", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-12-01T00:00:00Z") })
      .where(eq(cardStates.termId, 1));

    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(0);
  });

  it("filtra por tipo de término", async () => {
    await saveExtraction(db, {
      ...base,
      items: [termino(1, "word"), termino(2, "phrasal_verb")],
    });
    const cola = await getDueQueue(db, { now: AHORA, type: "phrasal_verb" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("filtra por fuente", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    await saveExtraction(db, { ...base, title: "Libro B", items: [termino(2)] });

    const cola = await getDueQueue(db, { now: AHORA, source: "Libro B" });
    expect(cola).toHaveLength(1);
    expect(cola[0].term).toBe("palabra2");
  });

  it("trae el contexto y el ejemplo de cada término", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await getDueQueue(db, { now: AHORA });
    expect(carta.context).toBe("Frase con palabra1.");
    expect(carta.example).toBe("Ejemplo con palabra1.");
    expect(carta.translation).toBe("traducción1");
  });

  it("con la biblioteca vacía devuelve una cola vacía", async () => {
    expect(await getDueQueue(db, { now: AHORA })).toEqual([]);
  });

  it("trae los cuatro plazos, y el de Fácil es más lejano que el de Otra vez", async () => {
    await saveExtraction(db, { ...base, items: [termino(1)] });
    const [carta] = await getDueQueue(db, { now: AHORA });

    expect(Object.keys(carta.plazos).sort()).toEqual(["1", "2", "3", "4"]);
    for (const p of Object.values(carta.plazos)) expect(p).toMatch(/\S/);
    // "1 min" contra "8 días": el texto difiere, que es lo que verá el usuario
    expect(carta.plazos[4]).not.toBe(carta.plazos[1]);
  });

  it("una tarjeta ya respondida hoy no vuelve a la cola al recargar", async () => {
    await saveExtraction(db, { ...base, items: [termino(1), termino(2)] });
    expect(await getDueQueue(db, { now: AHORA })).toHaveLength(2);

    const { applyAnswer } = await import("@/db/repository/review");
    await applyAnswer(db, { answerId: "r1", termId: 1, rating: 3, now: AHORA });

    const cola = await getDueQueue(db, { now: AHORA });
    expect(cola.map((c) => c.termId)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npm test -- tests/db/review-queue.test.ts`
Expected: FAIL — no se puede resolver `@/db/repository/review`.

- [ ] **Step 3: Implementar la cola**

Crear `db/repository/review.ts`:

```typescript
import { and, eq, lte, asc, type SQL } from "drizzle-orm";
import { terms, termOccurrences, cardStates, sources } from "@/db/schema";
import { getNewCardsPerDay } from "@/db/repository/settings";
import type { Database } from "@/db/types";
import { State, fsrs } from "ts-fsrs";
import { toFsrsCard } from "@/lib/fsrs";

const programador = fsrs();

export type Valoracion = 1 | 2 | 3 | 4;

export type CartaCola = {
  termId: number;
  term: string;
  translation: string;
  type: string;
  level: string;
  context: string;
  example: string;
  esNueva: boolean;
  /** Cuándo reaparecería con cada botón, ya formateado en español. */
  plazos: Record<Valoracion, string>;
};

/** "1 min", "10 min", "8 días", "1,3 años". Nunca se escriben a mano. */
export function formatearPlazo(desde: Date, hasta: Date): string {
  const minutos = Math.round((hasta.getTime() - desde.getTime()) / 60000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.round(minutos / 1440);
  if (dias < 30) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = dias / 30.4;
  if (meses < 12) return `${meses.toFixed(1).replace(".", ",")} meses`;
  return `${(dias / 365).toFixed(1).replace(".", ",")} años`;
}

export type OpcionesCola = { now: Date; source?: string; type?: string };

/**
 * La cola del día: todo lo vencido, más tarjetas nuevas hasta el tope diario.
 * Lo vencido nunca se recorta: el tope solo limita la entrada de material nuevo.
 */
export async function getDueQueue(
  db: Database,
  opts: OpcionesCola,
): Promise<CartaCola[]> {
  const filtros: SQL[] = [];
  if (opts.type) filtros.push(eq(terms.type, opts.type));
  if (opts.source) filtros.push(eq(sources.title, opts.source));

  const filas = await db
    .selectDistinctOn([terms.id], {
      termId: terms.id,
      term: terms.term,
      translation: terms.translation,
      type: terms.type,
      level: terms.level,
      context: termOccurrences.context,
      example: termOccurrences.example,
      state: cardStates.state,
      due: cardStates.due,
      stability: cardStates.stability,
      difficulty: cardStates.difficulty,
      elapsedDays: cardStates.elapsedDays,
      scheduledDays: cardStates.scheduledDays,
      reps: cardStates.reps,
      lapses: cardStates.lapses,
      learningSteps: cardStates.learningSteps,
      lastReview: cardStates.lastReview,
    })
    .from(terms)
    .innerJoin(cardStates, eq(cardStates.termId, terms.id))
    .leftJoin(termOccurrences, eq(termOccurrences.termId, terms.id))
    .leftJoin(sources, eq(sources.id, termOccurrences.sourceId))
    .where(filtros.length > 0 ? and(...filtros) : undefined)
    .orderBy(asc(terms.id));

  const nuevas: CartaCola[] = [];
  const vencidas: CartaCola[] = [];

  for (const f of filas) {
    const previsiones = programador.repeat(toFsrsCard(f as never), opts.now);
    const carta: CartaCola = {
      termId: f.termId,
      term: f.term,
      translation: f.translation,
      type: f.type,
      level: f.level,
      context: f.context ?? "",
      example: f.example ?? "",
      esNueva: f.state === State.New,
      plazos: {
        1: formatearPlazo(opts.now, previsiones[1].card.due),
        2: formatearPlazo(opts.now, previsiones[2].card.due),
        3: formatearPlazo(opts.now, previsiones[3].card.due),
        4: formatearPlazo(opts.now, previsiones[4].card.due),
      },
    };
    if (carta.esNueva) nuevas.push(carta);
    else if (f.due <= opts.now) vencidas.push(carta);
  }

  const tope = await getNewCardsPerDay(db);
  return [...vencidas, ...nuevas.slice(0, tope)];
}
```

**Corrección (2026-09-07):** `nuevas.slice(0, tope)` **no es un tope diario**, y el
plan se equivocaba al darlo por bueno. `esNueva` es `state === State.New`, así que
responder el lote del día saca esas tarjetas del estado `New`: recargar `/repaso`
entregaba otro lote entero, y otro, hasta agotar la biblioteca — justo lo que el
spec quiere impedir ("Extraer 80 términos de golpe no debe convertirse en 80
tarjetas al día siguiente"), y en silencio, porque la app parece funcionar. Lo
implementado en su lugar:

- `review_logs.state` guarda el estado **anterior** a esa respuesta, así que una
  fila con `state = 0` es la introducción de una tarjeta nueva. El cupo del día es
  `max(0, tope - introducidasHoy)`, con
  `introducidasHoy = count(review_logs where state = 0 and reviewed_at >= inicio del día)`.
- **El día empieza a medianoche en `Europe/Madrid`**, no en UTC: constante
  `ZONA_HORARIA` en `lib/dia.ts`, con `inicioDelDia(now)` calculado en TypeScript a
  partir del `now` que ya recibe el repositorio (nunca `new Date()` dentro del
  repositorio, para que las pruebas manden sobre el reloj). No es una columna nueva
  en base de datos: hay una sola usuaria y está en España; si eso cambia, es una
  línea.
- **Lo vencido sigue llegando entero**: ningún tope lo recorta, ni siquiera con el
  cupo del día gastado.
- `adelantar` concede **otro lote del tamaño del tope sobre lo ya introducido hoy**
  (cupo = `tope`), no `tope * 2`. Con la semántica diaria, el botón solo aparece
  cuando el cupo está gastado, y ahí doblar un cupo gastado seguiría dando cero: el
  botón no podía funcionar en ningún caso.
- Con el tope a 0, la pantalla de cola vacía no ofrece "adelantar" (no podría dar
  nada) y sí el control del tope, que antes vivía solo en la pantalla de fin de
  sesión — con el tope a 0 esa pantalla era inalcanzable y no hay pantalla de
  ajustes: el usuario se quedaba encerrado.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npm test -- tests/db/review-queue.test.ts`
Expected: PASS, 9 pruebas.

La última prueba —la de reanudación— depende de `applyAnswer`, que se implementa en
la tarea 4. Escríbela ahora y déjala fallando si hace falta; debe pasar al terminar
la tarea 4, y esa tarea no está completa hasta que pase.

Si `selectDistinctOn` no está disponible en esta versión de Drizzle, agrupa en
JavaScript por `termId` quedándote con la primera aparición, como hace
`listTerms` en `db/repository/terms.ts`. Menciónalo en tu informe.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cola del día para el repaso"
```

---

### Task 4: Aplicar una respuesta, de forma idempotente

**Files:**
- Modify: `db/repository/review.ts`
- Test: `tests/db/review-answer.test.ts`

**Interfaces:**
- Consumes: `toFsrsCard`, `fromFsrsCard` (tarea 2), esquema.
- Produces:
  `applyAnswer(db, entrada): Promise<{ aplicada: boolean; proximaFecha: Date }>` con
  `entrada = { answerId: string; termId: number; rating: 1 | 2 | 3 | 4; now: Date }`.
  `aplicada` es `false` cuando la respuesta ya se había registrado.
  La consumen las tareas 5 y 6.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/db/review-answer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { applyAnswer } from "@/db/repository/review";
import { cardStates, reviewLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Rating, State } from "ts-fsrs";

let db: TestDb;
let closeDb: () => Promise<void>;
const AHORA = new Date("2026-09-10T09:00:00Z");

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
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
        context: "I came across a photo.",
        example: "She came across an article.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

async function ficha() {
  const [f] = await db.select().from(cardStates).where(eq(cardStates.termId, 1));
  return f;
}

describe("applyAnswer", () => {
  it("adelanta la tarjeta y registra el repaso", async () => {
    const antes = await ficha();
    expect(antes.state).toBe(State.New);

    const r = await applyAnswer(db, {
      answerId: "a1",
      termId: 1,
      rating: Rating.Good,
      now: AHORA,
    });

    expect(r.aplicada).toBe(true);
    const despues = await ficha();
    expect(despues.reps).toBe(1);
    expect(despues.state).not.toBe(State.New);
    expect(despues.due.getTime()).toBeGreaterThan(AHORA.getTime());
    expect(despues.lastReview?.getTime()).toBe(AHORA.getTime());
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("IGNORA una respuesta repetida con el mismo identificador", async () => {
    await applyAnswer(db, { answerId: "a1", termId: 1, rating: Rating.Good, now: AHORA });
    const tras_una = await ficha();

    const r = await applyAnswer(db, {
      answerId: "a1",
      termId: 1,
      rating: Rating.Good,
      now: new Date("2026-09-10T09:05:00Z"),
    });

    expect(r.aplicada).toBe(false);
    const tras_dos = await ficha();
    expect(tras_dos.reps).toBe(tras_una.reps);
    expect(tras_dos.due.getTime()).toBe(tras_una.due.getTime());
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("dos respuestas distintas sí se aplican las dos", async () => {
    await applyAnswer(db, { answerId: "a1", termId: 1, rating: Rating.Good, now: AHORA });
    await applyAnswer(db, {
      answerId: "a2",
      termId: 1,
      rating: Rating.Good,
      now: new Date("2026-09-10T09:20:00Z"),
    });
    expect((await ficha()).reps).toBe(2);
    expect(await db.select().from(reviewLogs)).toHaveLength(2);
  });

  it("«Otra vez» acorta el plazo frente a «Fácil»", async () => {
    // Sobre la MISMA tarjeta de partida, en dos bases idénticas, para que la
    // única diferencia sea el botón pulsado.
    const otra = await applyAnswer(db, {
      answerId: "x",
      termId: 1,
      rating: Rating.Again,
      now: AHORA,
    });

    const t2 = await createTestDb();
    await saveExtraction(t2.db, {
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
          context: "I came across a photo.",
          example: "She came across an article.",
        },
      ],
    });
    const facil = await applyAnswer(t2.db, {
      answerId: "y",
      termId: 1,
      rating: Rating.Easy,
      now: AHORA,
    });
    await t2.close();

    expect(otra.proximaFecha.getTime()).toBeLessThan(facil.proximaFecha.getTime());
  });

  it("falla si el término no existe", async () => {
    await expect(
      applyAnswer(db, { answerId: "z", termId: 999, rating: Rating.Good, now: AHORA }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npm test -- tests/db/review-answer.test.ts`
Expected: FAIL — `applyAnswer` no está exportada.

- [ ] **Step 3: Implementar**

Añadir a `db/repository/review.ts`. **Fusiona los imports con los que la tarea 3
ya puso en ese fichero**, no los dupliques: `fsrs`, `toFsrsCard`, `eq`, `cardStates`
y `Database` ya están importados allí; aquí solo son nuevos `Grade`, `reviewLogs`
y `fromFsrsCard`. Y `programador` ya existe: no lo declares otra vez.

```typescript
import { type Grade } from "ts-fsrs";
import { reviewLogs } from "@/db/schema";
import { fromFsrsCard } from "@/lib/fsrs";

export type EntradaRespuesta = {
  answerId: string;
  termId: number;
  rating: 1 | 2 | 3 | 4;
  now: Date;
};

/**
 * Aplica una valoración. El identificador la hace idempotente: si esa misma
 * respuesta ya se registró, no se vuelve a aplicar. Sin esto, un reintento
 * mandaría la tarjeta a una fecha equivocada sin dar ningún error visible.
 */
export async function applyAnswer(
  db: Database,
  entrada: EntradaRespuesta,
): Promise<{ aplicada: boolean; proximaFecha: Date }> {
  return db.transaction(async (tx) => {
    const yaRegistrada = await tx
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .where(eq(reviewLogs.answerId, entrada.answerId))
      .limit(1);

    const [fila] = await tx
      .select()
      .from(cardStates)
      .where(eq(cardStates.termId, entrada.termId))
      .limit(1);

    if (!fila) {
      throw new Error(`No existe ninguna tarjeta para el término ${entrada.termId}.`);
    }

    if (yaRegistrada.length > 0) {
      return { aplicada: false, proximaFecha: fila.due };
    }

    const { card } = programador.next(
      toFsrsCard(fila),
      entrada.now,
      entrada.rating as Grade,
    );

    await tx
      .update(cardStates)
      .set(fromFsrsCard(card))
      .where(eq(cardStates.termId, entrada.termId));

    await tx.insert(reviewLogs).values({
      answerId: entrada.answerId,
      termId: entrada.termId,
      rating: entrada.rating,
      state: fila.state,
      stability: fila.stability,
      difficulty: fila.difficulty,
      reviewedAt: entrada.now,
    });

    return { aplicada: true, proximaFecha: card.due };
  });
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npm test -- tests/db/review-answer.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Demostrar que la prueba de idempotencia sirve**

Quita temporalmente la comprobación de `yaRegistrada` y ejecuta la prueba: **debe
fallar**. Revierte y comprueba que `git diff db/repository/review.ts` queda vacío.
Pega ambas salidas en tu informe. Una prueba de idempotencia que no puede fallar
no protege de nada.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: aplicar respuestas de repaso de forma idempotente"
```

---

### Task 5: Rutas del repaso

**Files:**
- Create: `app/api/repaso/cola/route.ts`, `app/api/repaso/respuesta/route.ts`
- Test: `tests/api/repaso.test.ts`

**Interfaces:**
- Consumes: `getDueQueue`, `applyAnswer` (tareas 3 y 4), `getDb`.
- Produces:
  - `GET /api/repaso/cola?source=&type=` → `{ cartas: CartaCola[] }`
  - `POST /api/repaso/respuesta` con `{ answerId, termId, rating }` → `{ aplicada, proximaFecha }`
  Las consume la tarea 6.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/api/repaso.test.ts`, siguiendo el patrón de `tests/api/extract.test.ts`
(mock de `@/db/client` con `vi.hoisted`, base PGlite, `afterEach` que cierra):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { GET } from "@/app/api/repaso/cola/route";
import { POST } from "@/app/api/repaso/respuesta/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
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
        context: "I came across a photo.",
        example: "She came across an article.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

function post(body: unknown) {
  return new Request("http://localhost/api/repaso/respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/repaso/cola", () => {
  it("devuelve las cartas del día", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cartas).toHaveLength(1);
    expect(body.cartas[0].term).toBe("come across");
  });

  it("acepta filtros por tipo", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola?type=word"));
    expect((await res.json()).cartas).toHaveLength(0);
  });
});

describe("POST /api/repaso/respuesta", () => {
  it("registra una valoración", async () => {
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aplicada).toBe(true);
  });

  it("una respuesta repetida responde 200 pero no la aplica dos veces", async () => {
    await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    expect(res.status).toBe(200);
    expect((await res.json()).aplicada).toBe(false);
  });

  it("rechaza una valoración fuera de 1..4", async () => {
    const res = await POST(post({ answerId: "b", termId: 1, rating: 7 }));
    expect(res.status).toBe(400);
  });

  it("rechaza una petición sin identificador de respuesta", async () => {
    const res = await POST(post({ termId: 1, rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza un cuerpo mal formado", async () => {
    const res = await POST(
      new Request("http://localhost/api/repaso/respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{no es json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npm test -- tests/api/repaso.test.ts`
Expected: FAIL — no se resuelven las rutas.

- [ ] **Step 3: Implementar la ruta de la cola**

Crear `app/api/repaso/cola/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDueQueue } from "@/db/repository/review";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cartas = await getDueQueue(getDb(), {
    now: new Date(),
    source: url.searchParams.get("source") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
  });
  return NextResponse.json({ cartas });
}
```

- [ ] **Step 4: Implementar la ruta de la respuesta**

Crear `app/api/repaso/respuesta/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { applyAnswer } from "@/db/repository/review";
import { getDb } from "@/db/client";

export async function POST(request: Request) {
  let body: { answerId?: string; termId?: number; rating?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const { answerId, termId, rating } = body;

  if (typeof answerId !== "string" || answerId.trim() === "") {
    return NextResponse.json({ error: "Falta el identificador de la respuesta." }, { status: 400 });
  }
  if (!Number.isInteger(termId) || (termId as number) < 1) {
    return NextResponse.json({ error: "Término no válido." }, { status: 400 });
  }
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
    return NextResponse.json({ error: "Valoración no válida." }, { status: 400 });
  }

  try {
    const r = await applyAnswer(getDb(), {
      answerId,
      termId: termId as number,
      rating,
      now: new Date(),
    });
    return NextResponse.json(r);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No se pudo registrar la respuesta: ${detalle}` },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasan**

Run: `npm test`
Expected: PASS, 119 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rutas de cola y respuesta del repaso"
```

---

### Task 6: Orquestación de la sesión en el navegador

**Files:**
- Create: `lib/review-session.ts`
- Test: `tests/review-session.test.ts`

**Interfaces:**
- Consumes: las dos rutas de la tarea 5.
- Produces:
  `crearSesion(cartas, { enviar }): Sesion` donde `Sesion` expone
  `cartaActual()`, `responder(rating)`, `progreso()`, `pendientes()` y `resumen()`.
  La consume la tarea 7.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/review-session.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { crearSesion } from "@/lib/review-session";

const cartas = [
  { termId: 1, term: "a", translation: "a", type: "word", level: "B2", context: "c1", example: "e1", esNueva: true },
  { termId: 2, term: "b", translation: "b", type: "word", level: "B2", context: "c2", example: "e2", esNueva: true },
];

const ok = () => Promise.resolve({ aplicada: true, proximaFecha: new Date() });

describe("sesión de repaso", () => {
  it("avanza a la siguiente carta sin esperar al servidor", async () => {
    let resolver: (v: unknown) => void = () => {};
    const enviar = vi.fn(() => new Promise((r) => { resolver = r; }));
    const s = crearSesion(cartas, { enviar });

    expect(s.cartaActual()?.termId).toBe(1);
    s.responder(3);
    expect(s.cartaActual()?.termId).toBe(2); // ya avanzó, con el envío en vuelo
    resolver({ aplicada: true, proximaFecha: new Date() });
  });

  it("envía un identificador distinto por respuesta", async () => {
    const enviar = vi.fn(ok);
    const s = crearSesion(cartas, { enviar });
    s.responder(3);
    s.responder(1);
    await s.pendientes();

    const ids = enviar.mock.calls.map((c) => (c[0] as { answerId: string }).answerId);
    expect(new Set(ids).size).toBe(2);
  });

  it("reintenta una respuesta que falló, con el mismo identificador", async () => {
    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockImplementation(ok);
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    await s.pendientes();

    expect(enviar).toHaveBeenCalledTimes(2);
    const [primera, segunda] = enviar.mock.calls.map((c) => c[0] as { answerId: string });
    expect(segunda.answerId).toBe(primera.answerId);
  });

  it("no pierde respuestas si varias fallan seguidas", async () => {
    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockRejectedValueOnce(new Error("red"))
      .mockImplementation(ok);
    const s = crearSesion(cartas, { enviar, reintentoMs: 0 });
    s.responder(3);
    s.responder(2);
    await s.pendientes();

    const enviadas = enviar.mock.calls.map((c) => (c[0] as { termId: number }).termId);
    expect(new Set(enviadas)).toEqual(new Set([1, 2]));
  });

  it("informa del progreso", () => {
    const s = crearSesion(cartas, { enviar: ok });
    expect(s.progreso()).toEqual({ hechas: 0, total: 2 });
    s.responder(3);
    expect(s.progreso()).toEqual({ hechas: 1, total: 2 });
  });

  it("al terminar no hay carta actual y el resumen cuadra", async () => {
    const s = crearSesion(cartas, { enviar: ok });
    s.responder(3);
    s.responder(1);
    await s.pendientes();

    expect(s.cartaActual()).toBeNull();
    expect(s.resumen()).toEqual({ total: 2, otraVez: 1, dificil: 0, bien: 1, facil: 0 });
  });

  it("con una cola vacía termina de inmediato", () => {
    const s = crearSesion([], { enviar: ok });
    expect(s.cartaActual()).toBeNull();
    expect(s.progreso()).toEqual({ hechas: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npm test -- tests/review-session.test.ts`
Expected: FAIL — no se resuelve `@/lib/review-session`.

- [ ] **Step 3: Implementar**

Crear `lib/review-session.ts`:

```typescript
import type { CartaCola } from "@/db/repository/review";

export type Valoracion = 1 | 2 | 3 | 4;

export type EnvioRespuesta = {
  answerId: string;
  termId: number;
  rating: Valoracion;
};

export type Resumen = {
  total: number;
  otraVez: number;
  dificil: number;
  bien: number;
  facil: number;
};

export type Sesion = {
  cartaActual: () => CartaCola | null;
  responder: (rating: Valoracion) => void;
  progreso: () => { hechas: number; total: number };
  /** Promesa que se resuelve cuando no queda ningún envío en vuelo. */
  pendientes: () => Promise<void>;
  resumen: () => Resumen;
};

export type OpcionesSesion = {
  enviar: (r: EnvioRespuesta) => Promise<unknown>;
  reintentoMs?: number;
  /** Inyectable para que las pruebas no dependan de crypto. */
  generarId?: () => string;
};

/**
 * La pantalla avanza en cuanto se pulsa un botón; el envío viaja aparte y se
 * reintenta con el MISMO identificador, que es lo que hace que un reintento no
 * pueda aplicar la valoración dos veces.
 */
export function crearSesion(cartas: CartaCola[], opts: OpcionesSesion): Sesion {
  const generarId =
    opts.generarId ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const reintentoMs = opts.reintentoMs ?? 1000;

  let indice = 0;
  const conteo: Resumen = { total: 0, otraVez: 0, dificil: 0, bien: 0, facil: 0 };
  const enVuelo = new Set<Promise<void>>();

  async function enviarConReintento(envio: EnvioRespuesta): Promise<void> {
    for (let intento = 0; ; intento += 1) {
      try {
        await opts.enviar(envio);
        return;
      } catch {
        if (intento >= 4) return; // se abandona tras cinco intentos
        await new Promise((r) => setTimeout(r, reintentoMs));
      }
    }
  }

  return {
    cartaActual: () => cartas[indice] ?? null,

    responder(rating) {
      const carta = cartas[indice];
      if (!carta) return;
      indice += 1;

      conteo.total += 1;
      if (rating === 1) conteo.otraVez += 1;
      else if (rating === 2) conteo.dificil += 1;
      else if (rating === 3) conteo.bien += 1;
      else conteo.facil += 1;

      const tarea = enviarConReintento({
        answerId: generarId(),
        termId: carta.termId,
        rating,
      });
      const seguimiento = tarea.finally(() => enVuelo.delete(seguimiento));
      enVuelo.add(seguimiento);
    },

    progreso: () => ({ hechas: indice, total: cartas.length }),

    async pendientes() {
      while (enVuelo.size > 0) await Promise.all([...enVuelo]);
    },

    resumen: () => ({ ...conteo }),
  };
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npm test -- tests/review-session.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: orquestación de la sesión de repaso en el navegador"
```

---

### Task 7: La pantalla de repaso

**Files:**
- Create: `components/SesionRepaso.tsx`, `app/repaso/page.tsx`
- Modify: `app/extraer/page.tsx` y `app/biblioteca/page.tsx` (enlace a Repaso)

**Interfaces:**
- Consumes: `crearSesion` (tarea 6), las rutas (tarea 5), los componentes de la tarea 1.
- Produces: la ruta `/repaso`.

- [ ] **Step 1: Construir la pantalla**

Requisitos, todos verificables a ojo:

- Al cargar, pide `GET /api/repaso/cola` y muestra **cuántas tocan hoy**.
- **Cara delantera:** el término en `Fraunces` grande, y debajo su frase de contexto
  con el término resaltado (fondo `--acento` al 15% y peso más fuerte).
- Un botón **Ver respuesta** que voltea. Toda la tarjeta es pulsable también.
- **Cara trasera:** traducción y ejemplo, y los cuatro botones de valoración con los
  colores de la tabla, **abajo, ocupando el ancho, mínimo 48px de alto**.
- Cada botón muestra debajo **cuándo volverá a aparecer**, obtenido del servidor.
  Nunca escrito a mano.
- Barra de progreso fina arriba: `hechas / total`.
- El teclado funciona: `Espacio` voltea, `1`-`4` valoran.
- Si la cola llega vacía: mensaje claro y un botón para adelantar palabras nuevas.
- Si la carga falla: mensaje de error en español, **nunca** el estado vacío.

Para los plazos, la ruta de la cola debe devolverlos. Amplía `getDueQueue` para
incluir `plazos: { 1: string; 2: string; 3: string; 4: string }` por carta,
calculados con `programador.repeat(toFsrsCard(fila), now)` y formateados en español
("1 min", "10 min", "8 días", "1,3 años"). Añade una prueba en
`tests/db/review-queue.test.ts` que compruebe que los cuatro plazos vienen y que el
de `Fácil` es posterior al de `Otra vez`.

- [ ] **Step 2: Verificar**

Run: `npm test`, `npx tsc --noEmit`, `npx eslint .` — todo limpio.

Arrancar `npm run dev` y hacer **una sesión real completa** con las 44 palabras del
usuario. Comprobar: que avanza sin esperas, que el progreso sube, que al terminar
sale el resumen, y que al recargar la página las respondidas **ya no vuelven a
aparecer**.

- [ ] **Step 3: Capturas para aprobación**

Móvil (390px) y escritorio, claro y oscuro, cara delantera y trasera: ocho
capturas. Entregar al usuario y esperar aprobación.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: pantalla de sesión de repaso"
```

---

### Task 8: Fin de sesión y ajuste del tope

**Files:**
- Modify: `components/SesionRepaso.tsx`
- Create: `app/api/ajustes/route.ts`
- Test: `tests/api/ajustes.test.ts`

**Interfaces:**
- Consumes: `getNewCardsPerDay`, `setNewCardsPerDay` (tarea 2).
- Produces: `GET`/`PATCH /api/ajustes` con `{ newCardsPerDay }`.

- [ ] **Step 1: Ruta de ajustes con pruebas**

Crear `tests/api/ajustes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { GET, PATCH } from "@/app/api/ajustes/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
});
afterEach(async () => {
  await closeDb();
});

function patch(body: unknown) {
  return new Request("http://localhost/api/ajustes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/ajustes", () => {
  it("devuelve 20 por defecto", async () => {
    const res = await GET();
    expect((await res.json()).newCardsPerDay).toBe(20);
  });

  it("cambia el tope y lo persiste", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 5 }))).status).toBe(200);
    expect((await (await GET()).json()).newCardsPerDay).toBe(5);
  });

  it("acepta 0: dejar de introducir palabras nuevas es legítimo", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 0 }))).status).toBe(200);
    expect((await (await GET()).json()).newCardsPerDay).toBe(0);
  });

  it("rechaza un valor no entero", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 0.5 }))).status).toBe(400);
  });

  it("rechaza un valor negativo", async () => {
    expect((await PATCH(patch({ newCardsPerDay: -1 }))).status).toBe(400);
  });

  it("rechaza un valor absurdamente alto", async () => {
    expect((await PATCH(patch({ newCardsPerDay: 999 }))).status).toBe(400);
  });

  it("rechaza un cuerpo mal formado", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/ajustes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{roto",
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

Ejecútalas, compruébalas fallando, y solo entonces escribe
`app/api/ajustes/route.ts`: `GET` devuelve `{ newCardsPerDay }` leído con
`getNewCardsPerDay`; `PATCH` valida que sea entero entre 0 y 200 —0 incluido, es
válido dejar de meter palabras nuevas— y responde 400 con mensaje en español si no,
antes de tocar la base de datos.

- [ ] **Step 2: Celebración final**

Al terminar la sesión: animación breve (CSS, sin librerías), el resumen con los
cuatro conteos, y un botón para volver a la biblioteca. **Sin contador de días
seguidos, sin logros, sin nada que reproche una ausencia.**

Respeta `prefers-reduced-motion`: si está activo, el resumen aparece sin animación.

- [ ] **Step 3: Control del tope**

Un control discreto en la pantalla de repaso para cambiar las tarjetas nuevas al
día. Se guarda en el servidor, no en el navegador.

- [ ] **Step 4: Verificar y commit**

```bash
git add -A
git commit -m "feat: cierre de sesión, celebración y tope de tarjetas nuevas"
```

---

### Task 9: Rediseño de la pantalla de extracción

**Files:**
- Modify: `components/ExtractForm.tsx`, `app/extraer/page.tsx`

**Interfaces:** consume los componentes de la tarea 1. No cambia ninguna lógica.

- [ ] **Step 1: Rehacer la presentación**

Sin tocar `lib/run-extraction.ts` ni ninguna ruta: solo presentación.

- Los campos agrupados como pasos legibles: primero el PDF, luego el rango y el nivel.
- Zona de arrastre para el PDF, no solo un botón de fichero.
- Barra de progreso real por lotes, con el rango de páginas en curso.
- El resultado como tarjeta destacada: términos nuevos, ya conocidos, y el coste.
- Los lotes fallidos, con su motivo, en un bloque de aviso claramente separado.

- [ ] **Step 2: Verificar que la lógica no cambió**

Run: `npm test` — las pruebas de `run-extraction` deben pasar **sin tocarlas**. Si
alguna necesita cambios, has modificado comportamiento: para y repórtalo.

Comprobar además `git diff lib/run-extraction.ts` vacío.

- [ ] **Step 3: Capturas y commit**

Cuatro capturas (móvil y escritorio, claro y oscuro).

```bash
git add -A
git commit -m "feat: rediseño de la pantalla de extracción"
```

---

### Task 10: Rediseño de la biblioteca

**Files:**
- Modify: `components/TermTable.tsx`, `app/biblioteca/page.tsx`

**Interfaces:** consume los componentes de la tarea 1. No cambia ninguna lógica.

- [ ] **Step 1: Rehacer la presentación**

- Cada término como tarjeta: el término en `Fraunces`, su traducción, una etiqueta
  de tipo con color propio y el nivel.
- Sus frases de contexto en cursiva, con el término resaltado.
- Los tres filtros como grupo de botones, no desplegables sueltos.
- Edición en línea que deje claro cuándo se ha guardado.
- El estado de error de carga, ya existente, con el diseño nuevo. **No lo elimines:
  distingue "no tienes vocabulario" de "no he podido cargarlo".**

- [ ] **Step 2: Verificar**

Run: `npm test` — todas las pruebas de biblioteca pasan sin tocarlas.

Con `npm run dev`: comprobar que los filtros siguen filtrando, que editar guarda, y
que renombrar un término a uno que ya existe sigue mostrando el aviso de conflicto.

- [ ] **Step 3: Capturas y commit**

```bash
git add -A
git commit -m "feat: rediseño de la biblioteca"
```

---

### Task 11: Instalable en el móvil

**Files:**
- Create: `app/manifest.ts`, `app/icon.png` (512×512)
- Modify: `app/layout.tsx`

**Interfaces:** ninguna.

- [ ] **Step 1: Manifiesto**

Crear `app/manifest.ts` con el nombre "AppVocabulario", nombre corto
"Vocabulario", `display: "standalone"`, `start_url: "/repaso"`, color de fondo y de
tema tomados de los tokens (`#FBF7F1` y `#E1552C`), y el icono de 512×512.

`start_url` apunta a `/repaso` a propósito: quien abre la app desde el icono del
móvil viene a repasar, no a extraer.

- [ ] **Step 2: Icono**

Generar un icono simple y legible a tamaño pequeño, coherente con la paleta. Sin
texto largo.

- [ ] **Step 3: Verificar**

Con `npm run dev`, comprobar en las herramientas de desarrollo que el manifiesto se
carga sin errores y que la app es instalable.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: manifiesto e icono para instalar en el móvil"
```

---

### Task 12: Despliegue y prueba de aceptación

**Files:**
- Modify: `README.md`

**Interfaces:** ninguna.

- [ ] **Step 1: Documentar**

Actualizar el README: la pantalla `/repaso`, que la fase 2 **no consume API**, la
tabla `settings`, la migración de `learning_steps`, y que `start_url` es `/repaso`.
Mover la fase 2 de "no construida" a "construida" en el estado actual.

- [ ] **Step 2: Aplicar la migración en producción**

```bash
DATABASE_URL='<cadena de Neon>' npx drizzle-kit push
```

- [ ] **Step 3: Prueba de aceptación — la hace el usuario, no un agente**

La fase 2 no está terminada hasta que el usuario compruebe, en su móvil y en días
distintos:

1. Instalar la app en la pantalla de inicio y abrirla desde el icono.
2. Completar una sesión entera con una mano, sin esperas entre tarjetas.
3. Que al terminar el resumen cuadre con lo respondido.
4. Cerrar la app a mitad de una sesión y volver: lo respondido no reaparece.
5. **Al día siguiente:** que las palabras valoradas como "Otra vez" vuelvan y las
   de "Fácil" no.
6. Que el diseño le parezca cómodo tras varias sesiones, no solo bonito la primera.
