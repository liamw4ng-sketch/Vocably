# Colecciones y tamaño de sesión en el repaso — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/repaso` enseñe una pantalla previa donde se elige de qué colección salen las tarjetas —no aprendidas, aprendidas o mezcla— y cuántas, en vez de entrar directo en la primera carta.

**Architecture:** Toda la decisión de qué entra en una sesión se saca de `getDueQueue` a un módulo puro, `lib/repaso/coleccion.ts`, que no toca la base de datos y es genérico sobre el tipo de carta. `getDueQueue` pasa a ser solo consulta y reparto en cuatro grupos; el módulo puro compone. Las colecciones no se guardan: se derivan de `card_states.state`, que FSRS ya escribe.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind 4, Drizzle ORM sobre Neon Postgres, ts-fsrs, Vitest con PGlite.

**Spec:** `docs/superpowers/specs/2026-09-08-colecciones-repaso-design.md`

## Global Constraints

- **Todo en español**: nombres de funciones, variables, comentarios, mensajes de error y texto de pantalla. El código existente lo está; no lo mezcles.
- **`environment: "node"`, sin jsdom y sin `@testing-library`.** Es una convención deliberada del proyecto: la lógica pura se exporta del componente y se prueba; el estado de React no se prueba. No añadas jsdom.
- **`lib/ajustes.ts` no puede importar nada de la base de datos.** Lo carga el navegador; importar el repositorio arrastra `drizzle-orm/pg-core` y los nombres reales de las tablas al paquete del cliente. Lleva un comentario explicándolo: no lo rompas.
- **Migraciones como ficheros**, generadas con `npx drizzle-kit generate`. Las pruebas las aplican con `migrate()` desde `./drizzle`. Nunca edites una migración ya existente; añade una nueva.
- **Estados FSRS**: `New = 0`, `Learning = 1`, `Review = 2`, `Relearning = 3`. Usa el enum `State` de `ts-fsrs`, no los números sueltos.
- **Comandos**: `npm test` (suite entera), `npx vitest run <ruta>` (un fichero), `npx tsc --noEmit`, `npx eslint`. Los tres últimos tienen que quedar limpios antes de cada commit.
- **No hay prettier en el proyecto y no hay configuración suya.** No ejecutes `npx prettier`: reformatea ficheros enteros y ensucia el diff.
- El punto de partida es la rama `main` en `186324d`.

**Una desviación de la especificación, a propósito:** §6 dibuja `componerSesion(...): CartaCola[]`. Aquí devuelve `{ cartas, repasosFuera }` y es **genérica sobre el tipo de carta** (`<T>`), no atada a `CartaCola`. Dos razones: `repasosFuera` se calcula donde se decide quién queda fuera, en vez de recalcularlo después; y la genérica evita que el módulo puro importe de `db/repository/review.ts`, que a su vez lo importa a él —un ciclo— y permite probarlo con objetos de tres líneas.

---

### Task 1: El módulo puro de colecciones

Toda la lógica de qué entra en una sesión, sin base de datos y sin React. Es la tarea con más pruebas del plan a propósito: si esto está bien, el resto es fontanería.

**Files:**
- Modify: `lib/ajustes.ts`
- Create: `lib/repaso/coleccion.ts`
- Test: `tests/repaso/coleccion.test.ts`

**Interfaces:**
- Consumes: `barajar(elementos, aleatorio?)` de `@/lib/barajar`; `State` de `ts-fsrs`.
- Produces:
  - `MODOS: readonly ["no-aprendidas", "aprendidas", "mezcla"]`, `type Modo`, `MODO_POR_DEFECTO: Modo`, `esModo(valor: unknown): valor is Modo`, `MAXIMO_TAMANO_SESION = 500` — todos en `@/lib/ajustes`.
  - `coleccionDe(state: number): Coleccion`, `type Coleccion = "no-aprendidas" | "aprendidas"`, `type Grupos<T>`, `type OpcionesSesion`, `componerSesion<T>(grupos, opciones): { cartas: T[]; repasosFuera: number }` — en `@/lib/repaso/coleccion`.

- [ ] **Step 1: Escribir las pruebas del módulo puro**

Crea `tests/repaso/coleccion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coleccionDe, componerSesion, type Grupos } from "@/lib/repaso/coleccion";

/** Una carta de mentira: al composer solo le importa la identidad. */
function carta(id: number) {
  return { id };
}
type Carta = ReturnType<typeof carta>;

function grupos(parcial: Partial<Grupos<Carta>> = {}): Grupos<Carta> {
  return {
    enCurso: [],
    nuevas: [],
    aprendidasVencidas: [],
    aprendidasFuturas: [],
    ...parcial,
  };
}

const ids = (cartas: Carta[]) => cartas.map((c) => c.id);

describe("coleccionDe", () => {
  it("solo el estado Review cuenta como aprendida", () => {
    expect(coleccionDe(2)).toBe("aprendidas");
  });

  it("nueva, en aprendizaje y en reaprendizaje son la misma colección", () => {
    expect(coleccionDe(0)).toBe("no-aprendidas");
    expect(coleccionDe(1)).toBe("no-aprendidas");
    expect(coleccionDe(3)).toBe("no-aprendidas");
  });
});

describe("componerSesion, con cuantas = 0", () => {
  it("mezcla trae lo vencido entero y las nuevas hasta el tope diario", () => {
    const { cartas } = componerSesion(
      grupos({
        enCurso: [carta(1)],
        aprendidasVencidas: [carta(2), carta(3)],
        nuevas: [carta(4), carta(5), carta(6)],
      }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 2 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3, 4, 5]);
  });

  it("no adelanta nunca lo que aún no vencía", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], aprendidasFuturas: [carta(9)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1]);
  });
});

describe("componerSesion, con un número explícito", () => {
  it("recorta al número pedido", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3), carta(4)] }),
      { modo: "aprendidas", cuantas: 2, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(cartas).toHaveLength(2);
  });

  it("adelanta lo que aún no vencía hasta completar el número", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], aprendidasFuturas: [carta(8), carta(9)] }),
      { modo: "aprendidas", cuantas: 3, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1, 8, 9]);
  });

  it("ignora el tope diario de nuevas: manda el número", () => {
    const { cartas } = componerSesion(
      grupos({ nuevas: [carta(1), carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 3, limiteNuevas: 1 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3]);
  });

  it("si no hay material para el número, la sesión es más corta y no roba de la otra colección", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1)], nuevas: [carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 10, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1]);
  });
});

describe("componerSesion, los modos", () => {
  it("no-aprendidas deja fuera las aprendidas, vencidas o no", () => {
    const { cartas } = componerSesion(
      grupos({
        enCurso: [carta(1)],
        nuevas: [carta(2)],
        aprendidasVencidas: [carta(3)],
        aprendidasFuturas: [carta(4)],
      }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([1, 2]);
  });

  it("aprendidas no cuela las que están en curso, aunque estén vencidas", () => {
    const { cartas } = componerSesion(
      grupos({ enCurso: [carta(1)], aprendidasVencidas: [carta(2)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(ids(cartas)).toEqual([2]);
  });

  it("un modo cuya colección está vacía devuelve una sesión vacía, no revienta", () => {
    const { cartas } = componerSesion(grupos({ nuevas: [carta(1)] }), {
      modo: "aprendidas",
      cuantas: 5,
      limiteNuevas: 10,
    });

    expect(cartas).toEqual([]);
  });
});

describe("componerSesion, el sorteo", () => {
  /**
   * El sorteo solo actúa donde hay que elegir. Con `aleatorio` fijado se puede
   * comprobar el resultado exacto, no solo la longitud.
   */
  it("sortea los repasos vencidos cuando hay que dejar alguno fuera", () => {
    const vencidas = [carta(1), carta(2), carta(3), carta(4)];
    const { cartas } = componerSesion(grupos({ aprendidasVencidas: vencidas }), {
      modo: "aprendidas",
      cuantas: 2,
      limiteNuevas: 10,
      aleatorio: () => 0,
    });

    // barajar con aleatorio()=0 rota el array; lo que importa es que NO sea
    // el orden de llegada, o el sorteo no estaría actuando.
    expect(ids(cartas)).not.toEqual([1, 2]);
    expect(cartas).toHaveLength(2);
  });

  it("no toca el orden si caben todas", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 0, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3]);
  });

  it("las en curso nunca entran en el sorteo: van en orden y enteras", () => {
    const { cartas } = componerSesion(
      grupos({ enCurso: [carta(1), carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 3, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([1, 2, 3]);
  });

  it("las adelantadas van por orden de llegada, que es el de vencimiento", () => {
    const { cartas } = componerSesion(
      grupos({ aprendidasFuturas: [carta(7), carta(8), carta(9)] }),
      { modo: "aprendidas", cuantas: 2, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(ids(cartas)).toEqual([7, 8]);
  });
});

describe("componerSesion, repasosFuera", () => {
  it("cuenta los repasos vencidos que el número dejó fuera", () => {
    const { repasosFuera } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2), carta(3)] }),
      { modo: "aprendidas", cuantas: 1, limiteNuevas: 10, aleatorio: () => 0 },
    );

    expect(repasosFuera).toBe(2);
  });

  it("es cero cuando entran todos", () => {
    const { repasosFuera } = componerSesion(
      grupos({ aprendidasVencidas: [carta(1), carta(2)] }),
      { modo: "mezcla", cuantas: 0, limiteNuevas: 10 },
    );

    expect(repasosFuera).toBe(0);
  });

  it("en modo no-aprendidas cuenta todos los vencidos, porque el modo los deja fuera", () => {
    const { repasosFuera } = componerSesion(
      grupos({ nuevas: [carta(1)], aprendidasVencidas: [carta(2), carta(3)] }),
      { modo: "no-aprendidas", cuantas: 0, limiteNuevas: 10 },
    );

    expect(repasosFuera).toBe(2);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla por el motivo correcto**

Run: `npx vitest run tests/repaso/coleccion.test.ts`
Expected: FAIL con `Cannot find package '@/lib/repaso/coleccion'`. Si falla por otra cosa, arréglalo antes de seguir.

- [ ] **Step 3: Añadir los modos a `lib/ajustes.ts`**

Sustituye la constante `MAXIMO_REPASOS_POR_SESION` por esto, dejando intacto el comentario de cabecera del fichero y `TOPE_MAXIMO_TARJETAS_NUEVAS`:

```ts
/** Tamaño máximo de una sesión, con el mismo criterio que el tope de nuevas:
 * por encima de esto ya no es una preferencia, es un error de digitación.
 * 0 significa "las que toquen hoy", que es el valor por defecto. */
export const MAXIMO_TAMANO_SESION = 500;

/**
 * Los tres modos de la pantalla previa del repaso. Se definen aquí, y no junto
 * al composer, porque este módulo es el único que pueden importar a la vez el
 * servidor y el navegador sin arrastrar la base de datos detrás.
 */
export const MODOS = ["no-aprendidas", "aprendidas", "mezcla"] as const;
export type Modo = (typeof MODOS)[number];
export const MODO_POR_DEFECTO: Modo = "mezcla";

export function esModo(valor: unknown): valor is Modo {
  return typeof valor === "string" && (MODOS as readonly string[]).includes(valor);
}
```

`MAXIMO_REPASOS_POR_SESION` sigue usándose en `components/SesionRepaso.tsx` y `app/api/ajustes/route.ts`: **no los toques todavía**, se arreglan en la Task 2. El árbol queda roto entre este paso y el final de esta tarea; es lo esperado.

- [ ] **Step 4: Escribir `lib/repaso/coleccion.ts`**

```ts
import { State } from "ts-fsrs";
import type { Modo } from "@/lib/ajustes";
import { barajar } from "@/lib/barajar";

export type Coleccion = "no-aprendidas" | "aprendidas";

/**
 * A qué colección pertenece una carta según su estado FSRS.
 *
 * Solo `Review` cuenta como aprendida. `Relearning` es una palabra que
 * superaste y luego fallaste: la sabías, ya no, y por eso baja. Meterla en
 * "aprendidas" haría que elegir esa colección trajera justo las que no sabes.
 */
export function coleccionDe(state: number): Coleccion {
  return state === State.Review ? "aprendidas" : "no-aprendidas";
}

export type Grupos<T> = {
  enCurso: T[];
  nuevas: T[];
  aprendidasVencidas: T[];
  /** Aprendidas que aún no vencían, **ya ordenadas por fecha ascendente**. */
  aprendidasFuturas: T[];
};

export type OpcionesSesion = {
  modo: Modo;
  cuantas: number;
  /** Cupo diario de nuevas que queda. Solo se aplica con `cuantas === 0`. */
  limiteNuevas: number;
  /** Fuente de azar del sorteo. Se inyecta solo en las pruebas. */
  aleatorio?: () => number;
};

/** Un grupo y si se puede sortear cuando hay que recortarlo. */
type Tramo<T> = { cartas: T[]; sortear: boolean };

/**
 * Compone la sesión a partir de los cuatro grupos.
 *
 * Genérica sobre la carta a propósito: así este módulo no importa nada de
 * `db/repository/review.ts` —que sí importa a este— y se prueba con objetos de
 * una línea.
 *
 * `limiteNuevas` solo manda cuando `cuantas === 0`. Con un número explícito
 * manda el número, incluso por encima del tope diario: es una decisión del
 * usuario, y la regla vive aquí en vez de repartida entre esta función y quien
 * la llama.
 */
export function componerSesion<T>(
  grupos: Grupos<T>,
  opciones: OpcionesSesion,
): { cartas: T[]; repasosFuera: number } {
  const { modo, cuantas, limiteNuevas, aleatorio } = opciones;
  const sinRecorte = cuantas === 0;

  const nuevas = sinRecorte ? grupos.nuevas.slice(0, limiteNuevas) : grupos.nuevas;
  // Adelantar es exactamente lo que `cuantas = 0` promete no hacer.
  const futuras = sinRecorte ? [] : grupos.aprendidasFuturas;

  const enCurso: Tramo<T> = { cartas: grupos.enCurso, sortear: false };
  const vencidas: Tramo<T> = { cartas: grupos.aprendidasVencidas, sortear: true };
  const porVenir: Tramo<T> = { cartas: futuras, sortear: false };
  const sinAprender: Tramo<T> = { cartas: nuevas, sortear: false };

  const tramos: Tramo<T>[] =
    modo === "no-aprendidas"
      ? [enCurso, sinAprender]
      : modo === "aprendidas"
        ? [vencidas, porVenir]
        : [enCurso, vencidas, sinAprender, porVenir];

  const cartas: T[] = [];
  for (const tramo of tramos) {
    const hueco = sinRecorte ? tramo.cartas.length : cuantas - cartas.length;
    if (hueco <= 0) break;
    if (tramo.cartas.length <= hueco) {
      cartas.push(...tramo.cartas);
      continue;
    }
    // Solo aquí hay una decisión que tomar, y solo los repasos vencidos se
    // sortean: las nuevas van en el orden de la biblioteca y las adelantadas
    // por fecha, que es lo que hace que adelantar dos días seguidos no traiga
    // lo mismo.
    const fuente = tramo.sortear ? barajar(tramo.cartas, aleatorio) : tramo.cartas;
    cartas.push(...fuente.slice(0, hueco));
  }

  const dentro = new Set(cartas);
  const repasosFuera = grupos.aprendidasVencidas.filter((c) => !dentro.has(c)).length;

  return { cartas, repasosFuera };
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasan**

Run: `npx vitest run tests/repaso/coleccion.test.ts`
Expected: PASS, 18 pruebas.

- [ ] **Step 6: Commit**

```bash
git add lib/ajustes.ts lib/repaso/coleccion.ts tests/repaso/coleccion.test.ts
git commit -m "Decidir qué entra en una sesión de repaso, sin base de datos

El reparto vivía dentro de getDueQueue mezclado con la consulta. Sale a un
módulo puro y genérico sobre la carta, que se prueba con objetos de una
línea y no arrastra drizzle a ningún sitio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Renombrar el ajuste y dejar el árbol verde

`reviewsPerSession` pasa a ser `sessionSize`, y aparece `sessionMode`. **Esta tarea no cambia ningún comportamiento**: el número sigue limitando solo los repasos vencidos, como hoy. Cambiarle el significado es la Task 3. Separarlas es lo que permite que el renombrado no esconda un cambio de conducta.

**Files:**
- Modify: `db/schema.ts` (tabla `settings`)
- Create: `drizzle/0005_<nombre-generado>.sql` (lo genera drizzle-kit)
- Modify: `db/repository/settings.ts`
- Modify: `db/repository/review.ts:179` (solo el destructuring de `getAjustes`)
- Modify: `app/api/ajustes/route.ts`
- Modify: `components/SesionRepaso.tsx` (nombre del campo y de la constante)
- Test: `tests/db/settings.test.ts`, `tests/db/review-queue.test.ts` (renombrar los usos)

**Interfaces:**
- Consumes: `MAXIMO_TAMANO_SESION`, `MODOS`, `MODO_POR_DEFECTO`, `esModo` de la Task 1.
- Produces: `type Ajustes = { newCardsPerDay: number; sessionSize: number; sessionMode: Modo }`, `getAjustes(db)`, `setNewCardsPerDay(db, valor)`, `setSessionSize(db, valor)`, `setSessionMode(db, modo)`. Desaparecen `getReviewsPerSession` y `setReviewsPerSession`.

- [ ] **Step 1: Escribir las pruebas del repositorio de ajustes**

En `tests/db/settings.test.ts`, sustituye las pruebas que hablen de `reviewsPerSession` por estas y **conserva** las de `newCardsPerDay` tal cual:

```ts
it("el tamaño de sesión por defecto es 0: la app no recorta por su cuenta", async () => {
  expect((await getAjustes(db)).sessionSize).toBe(0);
});

it("el modo por defecto es mezcla", async () => {
  expect((await getAjustes(db)).sessionMode).toBe("mezcla");
});

it("guarda el tamaño de sesión", async () => {
  await setSessionSize(db, 15);
  expect((await getAjustes(db)).sessionSize).toBe(15);
});

it("guarda el modo", async () => {
  await setSessionMode(db, "aprendidas");
  expect((await getAjustes(db)).sessionMode).toBe("aprendidas");
});

it("guardar un ajuste no pisa el otro", async () => {
  await setNewCardsPerDay(db, 7);
  await setSessionSize(db, 15);
  await setSessionMode(db, "no-aprendidas");

  const ajustes = await getAjustes(db);
  expect(ajustes.newCardsPerDay).toBe(7);
  expect(ajustes.sessionSize).toBe(15);
  expect(ajustes.sessionMode).toBe("no-aprendidas");
});

it("rechaza un tamaño de sesión negativo", async () => {
  await expect(setSessionSize(db, -1)).rejects.toThrow();
});

it("rechaza un modo que no existe", async () => {
  await expect(setSessionMode(db, "inventado" as never)).rejects.toThrow();
});
```

Añade `setSessionSize` y `setSessionMode` al `import` de `@/db/repository/settings` y quita `setReviewsPerSession`.

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/db/settings.test.ts`
Expected: FAIL, `setSessionSize is not a function` o similar.

- [ ] **Step 3: Cambiar el esquema**

En `db/schema.ts`, sustituye la tabla `settings` entera por:

```ts
/** Ajustes de la app, tabla de una sola fila. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  newCardsPerDay: integer("new_cards_per_day").notNull().default(20),
  /** Cuántas tarjetas entran en una sesión. 0 = las que toquen hoy. */
  sessionSize: integer("session_size").notNull().default(0),
  /** Modo por defecto de la pantalla previa: no-aprendidas | aprendidas | mezcla. */
  sessionMode: text("session_mode").notNull().default("mezcla"),
});
```

- [ ] **Step 4: Generar la migración y ordenarla a mano**

```bash
npx drizzle-kit generate
```

Abre el fichero generado en `drizzle/`. Debe contener tres sentencias. **Reordénalas** para que los dos `ADD COLUMN` vayan antes del `DROP COLUMN`, y añade el comentario, igual que se hizo en `drizzle/0004_youthful_zarda.sql`:

```sql
-- Orden a propósito: los ADD COLUMN primero y el DROP el último, para que un
-- fallo a mitad deje la tabla con columnas de más y no con ajustes de menos.
ALTER TABLE "settings" ADD COLUMN "session_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "session_mode" text DEFAULT 'mezcla' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "reviews_per_session";
```

- [ ] **Step 5: Reescribir `db/repository/settings.ts`**

```ts
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import type { Database } from "@/db/types";
import { esModo, MODO_POR_DEFECTO, type Modo } from "@/lib/ajustes";

const FILA = 1;
export const TOPE_POR_DEFECTO = 20;
/** 0 significa "las que toquen hoy": la app no recorta por su cuenta. */
export const TAMANO_SESION_POR_DEFECTO = 0;

export type Ajustes = {
  newCardsPerDay: number;
  sessionSize: number;
  sessionMode: Modo;
};

/**
 * Los tres ajustes de una vez. `getDueQueue` los necesita juntos y en la misma
 * petición, así que leerlos por separado serían tres viajes a la base para una
 * tabla de una sola fila.
 */
export async function getAjustes(db: Database): Promise<Ajustes> {
  const filas = await db.select().from(settings).where(eq(settings.id, FILA)).limit(1);
  const guardado = filas[0]?.sessionMode;
  return {
    newCardsPerDay: filas[0]?.newCardsPerDay ?? TOPE_POR_DEFECTO,
    sessionSize: filas[0]?.sessionSize ?? TAMANO_SESION_POR_DEFECTO,
    // La columna es `text`: nada en la base impide que llegue una cadena que
    // ya no es un modo válido. Volver al de por defecto es mejor que dejar
    // pasar un valor con el que `componerSesion` no sabría qué hacer.
    sessionMode: esModo(guardado) ? guardado : MODO_POR_DEFECTO,
  };
}

export async function getNewCardsPerDay(db: Database): Promise<number> {
  return (await getAjustes(db)).newCardsPerDay;
}

/**
 * Cada `set` escribe SOLO su columna en el `onConflictDoUpdate`. Si escribiera
 * la fila entera, guardar un ajuste devolvería los otros a su valor por defecto.
 */
export async function setNewCardsPerDay(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tope de tarjetas nuevas debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, newCardsPerDay: valor })
    .onConflictDoUpdate({ target: settings.id, set: { newCardsPerDay: valor } });
}

export async function setSessionSize(db: Database, valor: number): Promise<void> {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("El tamaño de la sesión debe ser un entero no negativo.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, sessionSize: valor })
    .onConflictDoUpdate({ target: settings.id, set: { sessionSize: valor } });
}

export async function setSessionMode(db: Database, modo: Modo): Promise<void> {
  if (!esModo(modo)) {
    throw new Error("El modo de sesión no es uno de los válidos.");
  }
  await db
    .insert(settings)
    .values({ id: FILA, sessionMode: modo })
    .onConflictDoUpdate({ target: settings.id, set: { sessionMode: modo } });
}
```

- [ ] **Step 6: Arreglar los tres sitios que usaban el nombre viejo**

En `db/repository/review.ts`, en la línea que destructura `getAjustes`, cambia solo el nombre —el comportamiento se mantiene, es la Task 3 la que lo cambia:

```ts
const { newCardsPerDay: tope, sessionSize: limiteRepasos } = await getAjustes(db);
```

En `app/api/ajustes/route.ts`: importa `MAXIMO_TAMANO_SESION`, `MODOS` y `esModo` de `@/lib/ajustes` en vez de `MAXIMO_REPASOS_POR_SESION`, y sustituye el bloque de `reviewsPerSession` por estos dos:

```ts
const { newCardsPerDay, sessionSize, sessionMode } = body ?? {};

if (newCardsPerDay === undefined && sessionSize === undefined && sessionMode === undefined) {
  return NextResponse.json(
    { error: "La petición no trae ningún ajuste que cambiar." },
    { status: 400 },
  );
}

if (sessionSize !== undefined && !esEnteroEnRango(sessionSize, MAXIMO_TAMANO_SESION)) {
  return NextResponse.json(
    { error: `El tamaño de la sesión debe ser un entero entre 0 y ${MAXIMO_TAMANO_SESION}.` },
    { status: 400 },
  );
}

if (sessionMode !== undefined && !esModo(sessionMode)) {
  return NextResponse.json(
    { error: `El modo de sesión debe ser uno de: ${MODOS.join(", ")}.` },
    { status: 400 },
  );
}
```

Y abajo, junto al `setNewCardsPerDay`:

```ts
if (sessionSize !== undefined) await setSessionSize(db, sessionSize);
if (sessionMode !== undefined) await setSessionMode(db, sessionMode);
```

En `components/SesionRepaso.tsx`: cambia `CampoAjuste` a `"newCardsPerDay" | "sessionSize"`, la constante importada a `MAXIMO_TAMANO_SESION`, la línea del hook a `useAjusteNumerico("sessionSize", MAXIMO_TAMANO_SESION, montadoRef)`, y el `repasosSesion.fijar(ajustes.reviewsPerSession)` a `ajustes.sessionSize`. El `id` y la etiqueta del `Campo` se quedan como están: la pantalla se rehace en la Task 5.

- [ ] **Step 7: Renombrar los usos en las pruebas de la cola**

En `tests/db/review-queue.test.ts`, cambia el import y todas las llamadas de `setReviewsPerSession` a `setSessionSize`. No toques ninguna aserción: el comportamiento no ha cambiado en esta tarea, así que todas tienen que seguir pasando tal cual.

- [ ] **Step 8: Ejecutar la suite entera y las comprobaciones**

Run: `npm test && npx tsc --noEmit && npx eslint`
Expected: todo verde, sin errores de tipos ni de lint. Si alguna prueba de `review-queue` falla, has cambiado comportamiento sin querer: vuelve al paso 6.

- [ ] **Step 9: Commit**

```bash
git add db/schema.ts drizzle/ db/repository/settings.ts db/repository/review.ts app/api/ajustes/route.ts components/SesionRepaso.tsx tests/db/settings.test.ts tests/db/review-queue.test.ts
git commit -m "Renombrar el ajuste de repasos por sesión a tamaño de sesión

Solo el nombre y la columna nueva del modo: el número sigue limitando los
repasos vencidos igual que antes. Cambiarle el significado es el commit
siguiente, y separarlos es lo que deja ver que este no toca la conducta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `getDueQueue` recoge las aprendidas futuras y delega

Aquí sí cambia el comportamiento. El cambio grande no es la consulta sino **qué se descarta**: hoy una carta que no ha vencido y no es nueva se cae del bucle sin entrar en ningún grupo.

**Files:**
- Modify: `db/repository/review.ts:37-46` (tipo `OpcionesCola`) y `:100-193` (el cuerpo de `getDueQueue`)
- Test: `tests/db/review-queue.test.ts`

**Interfaces:**
- Consumes: `componerSesion`, `type Grupos` de `@/lib/repaso/coleccion`; `type Modo` de `@/lib/ajustes`; `getAjustes` de la Task 2.
- Produces: `OpcionesCola` gana `modo?: Modo` y `cuantas?: number`, y **pierde** `adelantar`. `Cola` no cambia: sigue siendo `{ cartas, repasosFuera }`.

- [ ] **Step 1: Escribir las pruebas nuevas de la cola**

Añade a `tests/db/review-queue.test.ts`. Necesitarás un ayudante nuevo junto a `madurar`:

```ts
/** Deja esos términos como aprendidas que aún NO vencen. */
async function aprendidaFutura(termId: number, due: Date) {
  await db.update(cardStates).set({ state: 2, reps: 3, due }).where(eq(cardStates.termId, termId));
}
```

Y las pruebas:

```ts
describe("modos de sesión", () => {
  it("no-aprendidas deja fuera los repasos vencidos", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2)]);
    await madurar([termIds[0]]);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas" });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[1]]);
  });

  it("aprendidas deja fuera las nuevas y las que están en curso", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2), termino(3)]);
    await madurar([termIds[0]]);
    await enAprendizaje([termIds[1]]);

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas" });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });
});

describe("adelantar aprendidas con un tamaño de sesión", () => {
  /**
   * La regresión que importa: antes de este cambio, una aprendida que aún no
   * vencía se caía del bucle de `getDueQueue` sin entrar en ningún grupo, así
   * que no había forma de adelantarla.
   */
  it("una aprendida que aún no vence entra si el número lo pide", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-20T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 5 });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });

  it("y NO entra con el número a 0, que promete no adelantar nada", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-20T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 0 });

    expect(cartas).toEqual([]);
  });

  it("se adelanta la más próxima primero", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2)]);
    await aprendidaFutura(termIds[0], new Date("2026-09-30T09:00:00Z"));
    await aprendidaFutura(termIds[1], new Date("2026-09-12T09:00:00Z"));

    const cartas = await cartasDe({ now: AHORA, modo: "aprendidas", cuantas: 1 });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[1]]);
  });

  it("el número manda sobre el tope diario de tarjetas nuevas", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2), termino(3)]);
    await setNewCardsPerDay(db, 1);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas", cuantas: 3 });

    expect(cartas).toHaveLength(3);
    expect(new Set(cartas.map((c) => c.termId))).toEqual(new Set(termIds));
  });

  it("con el número a 0 el tope diario sigue mandando", async () => {
    await saveExtraction(db, base, [termino(1), termino(2), termino(3)]);
    await setNewCardsPerDay(db, 1);

    const cartas = await cartasDe({ now: AHORA, modo: "no-aprendidas", cuantas: 0 });

    expect(cartas).toHaveLength(1);
  });
});

describe("el modo y el número salen de los ajustes si no se piden", () => {
  it("usa el tamaño guardado cuando la llamada no trae número", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2), termino(3)]);
    await madurar(termIds);
    await setSessionSize(db, 2);

    const cartas = await cartasDe({ now: AHORA });

    expect(cartas).toHaveLength(2);
  });

  it("usa el modo guardado cuando la llamada no trae modo", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2)]);
    await madurar([termIds[0]]);
    await setSessionMode(db, "aprendidas");

    const cartas = await cartasDe({ now: AHORA });

    expect(cartas.map((c) => c.termId)).toEqual([termIds[0]]);
  });
});
```

Añade `setSessionMode` al import de `@/db/repository/settings`.

**Además**, borra las pruebas existentes que usen `adelantar: true` y sustitúyelas por su equivalente con el número: adelantar nuevas es ahora `{ modo: "no-aprendidas", cuantas: N }`. Si alguna prueba comprueba que adelantar concede "otro lote del tamaño del tope", bórrala: esa regla desaparece con `adelantar` y la sustituye el número explícito.

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/db/review-queue.test.ts`
Expected: FAIL. Las de `modo` y `cuantas` fallan porque `OpcionesCola` no los conoce (error de tipos en la ejecución de vitest o aserción incumplida); las de adelantar aprendidas fallan devolviendo una lista vacía.

- [ ] **Step 3: Cambiar `OpcionesCola`**

En `db/repository/review.ts`, sustituye el tipo por:

```ts
export type OpcionesCola = {
  now: Date;
  source?: string;
  type?: string;
  /** Si no se pasa, manda el modo guardado en los ajustes. */
  modo?: Modo;
  /** Si no se pasa, manda el tamaño guardado. 0 = las que toquen hoy. */
  cuantas?: number;
  /** Fuente de azar del sorteo de repasos. Se inyecta solo en las pruebas. */
  aleatorio?: () => number;
};
```

Añade arriba `import { componerSesion, type Grupos } from "@/lib/repaso/coleccion";` y `import type { Modo } from "@/lib/ajustes";`. Quita el import de `barajar`, que ahora vive en el composer.

- [ ] **Step 4: Cambiar el reparto y el final de `getDueQueue`**

Sustituye la declaración de los tres acumuladores por cuatro. Las futuras se acumulan con su fecha para poder ordenarlas:

```ts
  const vistos = new Set<number>();
  const nuevas: CartaCola[] = [];
  const enCurso: CartaCola[] = [];
  const aprendidasVencidas: CartaCola[] = [];
  const futurasConFecha: { carta: CartaCola; due: Date }[] = [];
```

Sustituye el bloque de clasificación del final del bucle:

```ts
    if (carta.esNueva) nuevas.push(carta);
    else if (f.state === State.Review) {
      // Las que aún no vencen ya no se tiran: son las que se pueden adelantar.
      if (f.due <= opts.now) aprendidasVencidas.push(carta);
      else futurasConFecha.push({ carta, due: f.due });
    } else if (f.due <= opts.now) enCurso.push(carta);
```

Y sustituye todo lo que va desde el comentario de `// El tope es DIARIO` hasta el `return` por:

```ts
  // El tope es DIARIO: lo que queda de cupo es el tope menos lo que ya se ha
  // introducido hoy, no el tope entero en cada petición. Solo actúa cuando el
  // usuario no ha pedido un tamaño de sesión; ver `componerSesion`.
  const { newCardsPerDay: tope, sessionSize, sessionMode } = await getAjustes(db);
  const limiteNuevas = Math.max(0, tope - (await introducidasHoy(db, opts.now)));

  // La más próxima primero: adelantar al azar traería lo mismo dos días
  // seguidos y dejaría lo de pasado mañana sin tocar.
  const grupos: Grupos<CartaCola> = {
    enCurso,
    nuevas,
    aprendidasVencidas,
    aprendidasFuturas: futurasConFecha
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .map((f) => f.carta),
  };

  return componerSesion(grupos, {
    modo: opts.modo ?? sessionMode,
    cuantas: opts.cuantas ?? sessionSize,
    limiteNuevas,
    aleatorio: opts.aleatorio,
  });
}
```

Actualiza también el comentario de bloque de `getDueQueue` (el que describe los tres grupos) para que hable de cuatro y mencione que la composición vive en `lib/repaso/coleccion.ts`.

- [ ] **Step 5: Ejecutar la suite entera**

Run: `npm test && npx tsc --noEmit && npx eslint`
Expected: todo verde. El único sitio que puede quedar roto es `app/api/repaso/cola/route.ts`, que sigue pasando `adelantar`: bórralo de esa llamada ahora —la ruta se termina en la Task 4— y deja de leer el parámetro.

- [ ] **Step 6: Commit**

```bash
git add db/repository/review.ts app/api/repaso/cola/route.ts tests/db/review-queue.test.ts
git commit -m "Poder adelantar palabras aprendidas, no solo nuevas

getDueQueue tiraba las aprendidas que aún no vencían: se caían del bucle
sin entrar en ningún grupo, así que no había forma de pedirlas. Ahora se
recogen aparte, ordenadas por fecha, y el composer decide.

'adelantar' desaparece: la pantalla previa con su número lo cubre, y dos
mecanismos para lo mismo acaban contradiciéndose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: El resumen de colecciones y los parámetros de la cola

**Files:**
- Modify: `db/repository/review.ts` (añadir `contarColecciones` al final)
- Create: `app/api/repaso/resumen/route.ts`
- Modify: `app/api/repaso/cola/route.ts`
- Test: `tests/db/review-resumen.test.ts`

**Interfaces:**
- Consumes: `getAjustes` (Task 2), `introducidasHoy` (privada, ya existe en `review.ts`).
- Produces: `type ResumenColecciones = { hoy: { sinAprender: number; aprendidas: number }; total: { sinAprender: number; aprendidas: number } }` y `contarColecciones(db, ahora): Promise<ResumenColecciones>`, exportados desde `@/db/repository/review`. `GET /api/repaso/resumen` devuelve ese objeto. `GET /api/repaso/cola` acepta `?modo=` y `?cuantas=`.

- [ ] **Step 1: Escribir las pruebas del resumen**

Crea `tests/db/review-resumen.test.ts`. Copia el bloque de `beforeEach`/`afterEach`, `base`, `termino` y `madurar` de `tests/db/review-queue.test.ts` —la duplicación entre ficheros de prueba es la norma del proyecto— y añade:

```ts
import { contarColecciones } from "@/db/repository/review";
import { setNewCardsPerDay } from "@/db/repository/settings";

describe("contarColecciones", () => {
  it("una biblioteca vacía cuenta cero en todo", async () => {
    expect(await contarColecciones(db, AHORA)).toEqual({
      hoy: { sinAprender: 0, aprendidas: 0 },
      total: { sinAprender: 0, aprendidas: 0 },
    });
  });

  it("separa lo vencido de lo adelantable en las aprendidas", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1), termino(2)]);
    await madurar([termIds[0]]);
    await db
      .update(cardStates)
      .set({ state: 2, reps: 3, due: new Date("2026-09-30T09:00:00Z") })
      .where(eq(cardStates.termId, termIds[1]));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.aprendidas).toBe(1);
    expect(resumen.total.aprendidas).toBe(2);
  });

  it("las nuevas de hoy están recortadas por el tope diario, las totales no", async () => {
    await saveExtraction(db, base, [termino(1), termino(2), termino(3)]);
    await setNewCardsPerDay(db, 1);

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(1);
    expect(resumen.total.sinAprender).toBe(3);
  });

  it("las que están en curso y vencidas cuentan como sin aprender", async () => {
    const { termIds } = await saveExtraction(db, base, [termino(1)]);
    await db
      .update(cardStates)
      .set({ state: 1, reps: 1, due: new Date("2026-09-10T08:50:00Z") })
      .where(eq(cardStates.termId, termIds[0]));

    const resumen = await contarColecciones(db, AHORA);

    expect(resumen.hoy.sinAprender).toBe(1);
    expect(resumen.hoy.aprendidas).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/db/review-resumen.test.ts`
Expected: FAIL, `contarColecciones is not a function`.

- [ ] **Step 3: Escribir `contarColecciones`**

Al final de `db/repository/review.ts`, y añade `sql` al import de `drizzle-orm`:

```ts
export type ResumenColecciones = {
  /** Lo que entraría hoy sin pedir nada: lo vencido, con el tope diario puesto. */
  hoy: { sinAprender: number; aprendidas: number };
  /** Todo lo disponible, incluido lo que habría que adelantar. */
  total: { sinAprender: number; aprendidas: number };
};

/**
 * Los contadores de la pantalla previa. Cuatro `count` sobre una tabla, en vez
 * de construir la cola entera y medirla: la pantalla se pinta antes de que el
 * usuario haya elegido nada, y construir la cola implica calcular los cuatro
 * plazos de cada carta con FSRS.
 */
export async function contarColecciones(db: Database, ahora: Date): Promise<ResumenColecciones> {
  const [fila] = await db
    .select({
      nuevas: sql<number>`count(*) filter (where ${cardStates.state} = ${State.New})::int`,
      enCursoVencidas: sql<number>`count(*) filter (where ${cardStates.state} in (${State.Learning}, ${State.Relearning}) and ${cardStates.due} <= ${ahora})::int`,
      aprendidasVencidas: sql<number>`count(*) filter (where ${cardStates.state} = ${State.Review} and ${cardStates.due} <= ${ahora})::int`,
      aprendidasTotal: sql<number>`count(*) filter (where ${cardStates.state} = ${State.Review})::int`,
    })
    .from(cardStates);

  const nuevas = fila?.nuevas ?? 0;
  const enCurso = fila?.enCursoVencidas ?? 0;
  const tope = (await getAjustes(db)).newCardsPerDay;
  const cupo = Math.max(0, tope - (await introducidasHoy(db, ahora)));

  return {
    hoy: {
      sinAprender: enCurso + Math.min(nuevas, cupo),
      aprendidas: fila?.aprendidasVencidas ?? 0,
    },
    total: {
      sinAprender: enCurso + nuevas,
      aprendidas: fila?.aprendidasTotal ?? 0,
    },
  };
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run tests/db/review-resumen.test.ts`
Expected: PASS, 4 pruebas.

- [ ] **Step 5: Crear la ruta del resumen**

Crea `app/api/repaso/resumen/route.ts`:

```ts
import { NextResponse } from "next/server";
import { contarColecciones } from "@/db/repository/review";
import { getDb } from "@/db/client";

/** Los contadores de la pantalla previa del repaso. No construye la cola. */
export async function GET() {
  return NextResponse.json(await contarColecciones(getDb(), new Date()));
}
```

- [ ] **Step 6: Aceptar `modo` y `cuantas` en la ruta de la cola**

Sustituye el cuerpo de `app/api/repaso/cola/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDueQueue } from "@/db/repository/review";
import { esModo } from "@/lib/ajustes";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modo = url.searchParams.get("modo");
  const cuantas = url.searchParams.get("cuantas");
  const numero = cuantas === null ? undefined : Number(cuantas);

  // Un parámetro ilegible no se ignora en silencio: sin esto, un `cuantas=hola`
  // daría NaN, `componerSesion` no recortaría nada y el usuario recibiría una
  // sesión distinta de la que pidió sin que nada se lo dijera.
  if (numero !== undefined && (!Number.isInteger(numero) || numero < 0)) {
    return NextResponse.json(
      { error: "El número de tarjetas debe ser un entero no negativo." },
      { status: 400 },
    );
  }

  // Se devuelve la cola entera: `cartas` y `repasosFuera`, que la pantalla
  // necesita para decir cuántos repasos quedaron fuera del límite.
  const cola = await getDueQueue(getDb(), {
    now: new Date(),
    source: url.searchParams.get("source") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    modo: esModo(modo) ? modo : undefined,
    cuantas: numero,
  });
  return NextResponse.json(cola);
}
```

- [ ] **Step 7: Ejecutar la suite entera**

Run: `npm test && npx tsc --noEmit && npx eslint`
Expected: todo verde.

- [ ] **Step 8: Commit**

```bash
git add db/repository/review.ts app/api/repaso/resumen/route.ts app/api/repaso/cola/route.ts tests/db/review-resumen.test.ts
git commit -m "Contar las colecciones sin construir la cola

La pantalla previa necesita saber cuántas hay de cada tipo antes de que el
usuario elija nada. Cuatro count sobre card_states, en vez de montar la cola
entera y medirla: construirla implica calcular con FSRS los cuatro plazos de
cada carta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: La pantalla previa

**Files:**
- Modify: `components/SesionRepaso.tsx`
- Test: `tests/sesion-repaso-previa.test.ts`

**Interfaces:**
- Consumes: `ResumenColecciones` (Task 4), `MODOS`, `MODO_POR_DEFECTO`, `MAXIMO_TAMANO_SESION`, `type Modo` (Task 1); los componentes `Boton`, `Campo` y `Tarjeta` de `@/components/ui/`.
- Produces: funciones puras exportadas `disponibles(resumen, modo, cuantas)` y `puedeEmpezar(resumen, modo, cuantas)`, más `ETIQUETA_MODO: Record<Modo, string>`.

- [ ] **Step 1: Escribir las pruebas de las funciones puras**

Crea `tests/sesion-repaso-previa.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { disponibles, puedeEmpezar, ETIQUETA_MODO } from "@/components/SesionRepaso";
import { MODOS } from "@/lib/ajustes";
import type { ResumenColecciones } from "@/db/repository/review";

function resumen(
  hoy: { sinAprender: number; aprendidas: number },
  total = hoy,
): ResumenColecciones {
  return { hoy, total };
}

describe("disponibles", () => {
  it("no-aprendidas solo mira la columna de sin aprender", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "no-aprendidas", 0)).toBe(3);
  });

  it("aprendidas solo mira la suya", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "aprendidas", 0)).toBe(9);
  });

  it("mezcla suma las dos", () => {
    const r = resumen({ sinAprender: 3, aprendidas: 9 });
    expect(disponibles(r, "mezcla", 0)).toBe(12);
  });

  it("con un número explícito cuenta lo adelantable, no solo lo de hoy", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 4, aprendidas: 6 });
    expect(disponibles(r, "aprendidas", 10)).toBe(6);
    expect(disponibles(r, "aprendidas", 0)).toBe(0);
  });
});

describe("puedeEmpezar", () => {
  it("no deja empezar un modo sin nada que enseñar", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 5 });
    expect(puedeEmpezar(r, "no-aprendidas", 0)).toBe(false);
    expect(puedeEmpezar(r, "aprendidas", 0)).toBe(true);
  });

  it("con un número, un modo vacío hoy sí se puede empezar si hay que adelantar", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 }, { sinAprender: 0, aprendidas: 7 });
    expect(puedeEmpezar(r, "aprendidas", 5)).toBe(true);
  });

  it("con la biblioteca vacía no se puede empezar de ninguna manera", () => {
    const r = resumen({ sinAprender: 0, aprendidas: 0 });
    for (const modo of MODOS) {
      expect(puedeEmpezar(r, modo, 0)).toBe(false);
      expect(puedeEmpezar(r, modo, 20)).toBe(false);
    }
  });
});

describe("ETIQUETA_MODO", () => {
  it("los tres modos tienen nombre en español", () => {
    expect(ETIQUETA_MODO["no-aprendidas"]).toBe("No aprendidas");
    expect(ETIQUETA_MODO.aprendidas).toBe("Aprendidas");
    expect(ETIQUETA_MODO.mezcla).toBe("Mezcla");
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/sesion-repaso-previa.test.ts`
Expected: FAIL, `disponibles is not exported`.

- [ ] **Step 3: Añadir las funciones puras al componente**

En `components/SesionRepaso.tsx`, junto a las demás funciones puras exportadas (cerca de `mostrarContexto`):

```ts
export const ETIQUETA_MODO: Record<Modo, string> = {
  "no-aprendidas": "No aprendidas",
  aprendidas: "Aprendidas",
  mezcla: "Mezcla",
};

/**
 * Cuántas tarjetas hay para un modo. Con el número a 0 solo cuenta lo vencido,
 * porque eso es lo único que entraría; con un número explícito cuenta también
 * lo adelantable, que es de donde saldría el resto.
 */
export function disponibles(
  resumen: ResumenColecciones,
  modo: Modo,
  cuantas: number,
): number {
  const lado = cuantas === 0 ? resumen.hoy : resumen.total;
  if (modo === "no-aprendidas") return lado.sinAprender;
  if (modo === "aprendidas") return lado.aprendidas;
  return lado.sinAprender + lado.aprendidas;
}

/** Un modo vacío tiene que salir desactivado, no fallar al pulsarlo. */
export function puedeEmpezar(
  resumen: ResumenColecciones,
  modo: Modo,
  cuantas: number,
): boolean {
  return disponibles(resumen, modo, cuantas) > 0;
}
```

Añade los imports: `import { MODOS, MODO_POR_DEFECTO, MAXIMO_TAMANO_SESION, TOPE_MAXIMO_TARJETAS_NUEVAS, type Modo } from "@/lib/ajustes";` y `import type { CartaCola, Cola, ResumenColecciones } from "@/db/repository/review";` — los dos son imports de tipo salvo las constantes, que no arrastran nada de la base de datos.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run tests/sesion-repaso-previa.test.ts`
Expected: PASS, 8 pruebas.

- [ ] **Step 5: Montar la pantalla previa**

Cambios en `components/SesionRepaso.tsx`.

**a)** `type Estado = "cargando" | "error" | "antes" | "lista";`

**b)** Junto a `pedirCola`, que cambia de firma:

```ts
async function pedirResumen(): Promise<ResumenColecciones> {
  const respuesta = await fetch("/api/repaso/resumen");
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return (await respuesta.json()) as ResumenColecciones;
}

async function pedirCola(modo: Modo, cuantas: number): Promise<Cola> {
  const respuesta = await fetch(`/api/repaso/cola?modo=${modo}&cuantas=${cuantas}`);
  if (!respuesta.ok) throw new Error(`respuesta ${respuesta.status}`);
  return (await respuesta.json()) as Cola;
}

/** Guardar el modo es igual que guardar un número, pero el valor no es numérico
 * y `guardarAjuste` valida y revierte pensando en enteros. */
async function guardarModo(modo: Modo): Promise<{ error: string } | null> {
  try {
    const respuesta = await fetch("/api/ajustes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionMode: modo }),
    });
    if (!respuesta.ok) return { error: "No se pudo guardar el modo." };
  } catch {
    return { error: "No se pudo conectar con el servidor." };
  }
  return null;
}
```

**c)** Estado nuevo dentro de `SesionRepaso`, junto a los que ya hay:

```ts
  const [resumen, setResumen] = useState<ResumenColecciones | null>(null);
  const [modo, setModo] = useState<Modo>(MODO_POR_DEFECTO);
  const [recordar, setRecordar] = useState(false);
  const [empezando, setEmpezando] = useState(false);
  const tamanoSesion = useAjusteNumerico("sessionSize", MAXIMO_TAMANO_SESION, montadoRef);
```

Renombra el hook `repasosSesion` a `tamanoSesion` en todos sus usos. `adelantado` y su `setAdelantado` desaparecen.

**d)** La carga inicial **ya no pide la cola**. Sustituye el cuerpo de `cargarInicial`:

```ts
    async function cargarInicial() {
      try {
        const [datos, ajustes] = await Promise.all([pedirResumen(), pedirAjustes()]);
        if (cancelado) return;
        setResumen(datos);
        setModo(ajustes.sessionMode);
        topeNuevas.fijar(ajustes.newCardsPerDay);
        tamanoSesion.fijar(ajustes.sessionSize);
        setEstado("antes");
      } catch {
        if (!cancelado) setEstado("error");
      }
    }
```

El efecto que pedía los ajustes al terminar la sesión (`ajustesSolicitadosRef`) sobra: ahora llegan en la carga inicial. Bórralo junto con ese ref y con `ajustesCargaFallo`.

**e)** La función que arranca la sesión:

```ts
  const empezar = useCallback(async () => {
    const cuantas = tamanoSesion.valor ?? 0;
    setEmpezando(true);
    try {
      // Se guarda ANTES de pedir la cola: si la cola falla, la preferencia ya
      // quedó guardada, que es lo que el usuario pidió al marcar la casilla.
      if (recordar) {
        await guardarAjuste("sessionSize", cuantas);
        await guardarModo(modo);
      }
      const cola = await pedirCola(modo, cuantas);
      if (!montadoRef.current) return;
      setCartas(cola.cartas);
      setRepasosFuera(cola.repasosFuera);
      setSesion(crearSesion(cola.cartas));
      setEstado("lista");
    } catch {
      if (montadoRef.current) setEstado("error");
    } finally {
      if (montadoRef.current) setEmpezando(false);
    }
  }, [modo, recordar, tamanoSesion.valor]);
```

**f)** La pantalla, justo antes del `if (!carta)` de la sesión en marcha:

```tsx
  if (estado === "antes" && resumen) {
    const cuantas = tamanoSesion.valor ?? 0;
    const hoy = resumen.hoy.sinAprender + resumen.hoy.aprendidas;
    const biblioteca = resumen.total.sinAprender + resumen.total.aprendidas;

    if (biblioteca === 0) {
      return (
        <Tarjeta className="flex flex-col gap-4">
          <h1 style={TEXTO_4} className="font-semibold">
            No tienes ninguna palabra todavía
          </h1>
          <p style={TEXTO_2} className="text-texto-suave">
            Añade vocabulario extrayéndolo de un PDF o buscándolo en el diccionario, y
            vuelve a esta pantalla.
          </p>
          <Boton variante="primario" onClick={() => router.push("/extraer")}>
            Extraer de un PDF
          </Boton>
          <Boton variante="secundario" onClick={() => router.push("/diccionario")}>
            Buscar en el diccionario
          </Boton>
        </Tarjeta>
      );
    }

    return (
      <Tarjeta className="flex flex-col gap-4">
        <h1 style={TEXTO_4} className="font-semibold">
          {hoy === 0 ? "Hoy no toca ninguna palabra" : `Hoy tienes ${hoy} palabras`}
        </h1>
        <p style={TEXTO_2} className="text-texto-suave">
          {hoy === 0
            ? "Estás al día. Si quieres seguir, pon un número y se adelantan las que vengan después."
            : `${resumen.hoy.sinAprender} sin aprender · ${resumen.hoy.aprendidas} aprendidas`}
        </p>

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend style={TEXTO_1} className="text-texto-suave">
            Repasar
          </legend>
          <div className="flex flex-wrap gap-2">
            {MODOS.map((opcion) => (
              <Boton
                key={opcion}
                variante={opcion === modo ? "primario" : "secundario"}
                disabled={!puedeEmpezar(resumen, opcion, cuantas)}
                onClick={() => setModo(opcion)}
              >
                {ETIQUETA_MODO[opcion]} ({disponibles(resumen, opcion, cuantas)})
              </Boton>
            ))}
          </div>
        </fieldset>

        <Campo
          id="tamano-sesion"
          etiqueta="Cuántas"
          claseControl="max-w-40"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAXIMO_TAMANO_SESION}
          value={tamanoSesion.borrador}
          disabled={tamanoSesion.guardando}
          onChange={(evento: React.ChangeEvent<HTMLInputElement>) =>
            tamanoSesion.setBorrador(evento.target.value)
          }
          onBlur={() => void tamanoSesion.confirmar()}
          error={tamanoSesion.error}
          ayuda={
            tamanoSesion.error
              ? undefined
              : "0 = las que toquen hoy. Cualquier otro número es exactamente ese, adelantando las que aún no tocaban."
          }
        />

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={recordar}
            onChange={(evento) => setRecordar(evento.target.checked)}
          />
          <span style={TEXTO_2}>Recordar esta elección</span>
        </label>

        <Boton
          variante="primario"
          disabled={!puedeEmpezar(resumen, modo, cuantas) || empezando}
          onClick={() => void empezar()}
        >
          {empezando ? "Preparando…" : "Empezar"}
        </Boton>
        <Boton variante="secundario" onClick={() => router.push("/biblioteca")}>
          Volver a la biblioteca
        </Boton>
      </Tarjeta>
    );
  }
```

**g)** **Borra** la rama `if (total === 0)` de «Hoy no toca ninguna tarjeta», el botón «Adelantar palabras nuevas» y la constante `controlAjustes` entera: los tres casos los cubre ya la pantalla de arriba.

**h)** En la pantalla de fin de sesión, donde estaba `{controlAjustes}`, pon:

```tsx
        <Boton
          variante="secundario"
          onClick={() => {
            setSesion(null);
            setEstado("cargando");
            void pedirResumen()
              .then((datos) => {
                setResumen(datos);
                setEstado("antes");
              })
              .catch(() => setEstado("error"));
          }}
        >
          Volver a elegir
        </Boton>
```

- [ ] **Step 6: Comprobar en el navegador**

```bash
npm run dev
```

Entra en `/repaso` y comprueba, con la sesión iniciada: que sale la pantalla previa antes de cualquier carta; que un modo sin material sale desactivado y dice cuántas hay; que poner un número menor que lo vencido da exactamente esa cantidad; que poner un número mayor adelanta; y que con la casilla marcada, salir y volver a entrar conserva modo y número.

- [ ] **Step 7: Ejecutar la suite entera**

Run: `npm test && npx tsc --noEmit && npx eslint`
Expected: todo verde. Las pruebas de `tests/sesion-repaso-*.test.ts` que existían siguen pasando: no toques sus aserciones.

- [ ] **Step 8: Commit**

```bash
git add components/SesionRepaso.tsx tests/sesion-repaso-previa.test.ts
git commit -m "Elegir qué y cuánto repasar antes de empezar

/repaso entraba directo en la primera carta. El ajuste del tamaño de sesión
existía, pero solo se pintaba cuando no tocaba ninguna tarjeta y cuando la
sesión ya había terminado: los dos momentos en los que no sirve.

La pantalla previa sustituye también a la de 'hoy no toca nada' y al botón de
adelantar, que eran casos particulares de lo mismo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Después del plan

La migración de la Task 2 **no se aplica sola** contra la base de producción. Cuando el plan esté terminado y probado, hay que ejecutarla a mano y mirando, porque lleva un `DROP COLUMN` y `drizzle-kit push` pide confirmación ante una sentencia con pérdida de datos:

```bash
DATABASE_URL='...' npx drizzle-kit push
```

La tabla `settings` estaba vacía el 2026-09-08, así que no se pierde ningún valor del usuario, pero eso hay que volver a comprobarlo antes de ejecutarlo, no darlo por hecho.
