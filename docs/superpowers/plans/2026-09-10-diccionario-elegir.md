# El diccionario que deja elegir — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer la pantalla del diccionario de Vocably: una sola tarjeta por palabra, con las traducciones al español todas juntas en una lista, los significados en inglés numerados y a la vista, y al guardar se elige significado, traducción y nivel.

**Architecture:** Todo pasa en el cliente. `GET /api/diccionario` **no cambia**: ya devuelve las cuatro piezas que hace falta —`enBiblioteca`, `acepciones` con su `gloss`, `example`, `pos` y `translations`, y `significados`—. La lista unificada de traducciones se arma con una función pura que une los dos orígenes que ya viajan. **No hay migración ni carga: la base no se toca.**

**Tech Stack:** Next.js 16.3.4 (App Router), React 19, TypeScript estricto, Tailwind 4, Vitest en `environment: "node"`.

**Spec:** `docs/superpowers/specs/2026-09-10-diccionario-elegir-design.md`

## Global Constraints

- **Todo el código, comentarios y textos de pantalla en español.**
- **TDD sin excepciones.** Prueba primero, verla fallar, implementación mínima, verla pasar, commit.
- **Las pruebas corren en `environment: "node"`, sin jsdom y sin `@testing-library`.** Es deliberado: la lógica que puede fallar se extrae del componente como función pura exportada y se prueba así. El JSX no se prueba; se lee. **No añadas jsdom ni testing-library.**
- **Cero `eslint-disable` en el proyecto.** Si una regla molesta, rediseña.
- **NUNCA ejecutes `npx prettier`.** No es dependencia del proyecto: reformatearía ficheros enteros.
- **No toques la base de datos real ni uses `DATABASE_URL`.** Esta rama no necesita ninguna.
- **No arranques ningún servidor de desarrollo.** La aplicación pide contraseña; la comprobación visual la hace el usuario en su móvil.
- **La suite se ejecuta con `npx vitest run --no-file-parallelism`.** Con el paralelismo por defecto esta máquina da fallos falsos por timeout en ficheros que no has tocado. Partes de **612 pruebas en 56 ficheros**.
- Antes de cada commit: la suite, `npx tsc --noEmit` y `npx eslint .`.

## Lo que ya existe y hay que respetar

`components/BuscadorDiccionario.tsx` (538 líneas) exporta hoy, además del componente:

```ts
export async function buscarTermino(consulta, fetchImpl?): Promise<Resultado>
export async function anadirAcepcion(acepcion, nivel, traduccion, fetchImpl?): Promise<void>
export async function afinarConIA(entryId, fetchImpl?): Promise<string[]>
export function etiquetaDeOrigen(source: string): string
export function significadosDeLaAcepcion(significados, pos): string[]
export function botonAnadirDeshabilitado(nivel, traduccion, enCurso): boolean
export function cuandoTocaRepasar(due, ahora?): string
export function avisoSinAcepciones(numAcepciones, numEnBiblioteca): "no-esta" | "solo-en-biblioteca" | null
export type GrupoDeSignificados = { pos: string; nombre: string; meanings: string[]; source: string }
```

Y `lib/diccionario/traduccion.ts`, compartido con la pantalla de extraer:

```ts
export function traduccionParaGuardar(manual, deLaAcepcion, deLaPalabra): string
export function sinEspanolEnNingunOrigen(deLaAcepcion, deLaPalabra): boolean
```

**Cuáles sobreviven al rediseño:** `buscarTermino`, `anadirAcepcion`, `afinarConIA`, `cuandoTocaRepasar`, `avisoSinAcepciones`. Sus pruebas también.

**Cuáles se van:** `etiquetaDeOrigen` y `significadosDeLaAcepcion` — la primera porque al revolver las traducciones en una lista se pierde el origen (§10 de la especificación lo acepta), la segunda porque ya no hay una traducción por acepción que resolver. **Comprueba con `grep` que no las usa nadie más antes de borrarlas.**

**`botonAnadirDeshabilitado` cambia de firma**: gana la condición del significado elegido.

**`lib/diccionario/traduccion.ts` no se toca.** La usa la pantalla de extraer, y allí sigue haciendo falta.

---

## Estructura de ficheros

| Fichero | Cambio |
|---|---|
| `lib/diccionario/traducciones-posibles.ts` | **Nuevo.** Puro: une los dos orígenes en una lista sin repetidos. Va en `lib/` y no en el componente porque es lógica de datos, no de pantalla. |
| `tests/diccionario/traducciones-posibles.test.ts` | **Nuevo.** |
| `components/BuscadorDiccionario.tsx` | Las funciones puras de la elección, y el componente rehecho. |
| `tests/buscador-diccionario.test.ts` | Pruebas nuevas; se van las de las dos funciones retiradas. |

---

### Task 1: La lista unificada de traducciones

**Files:**
- Create: `lib/diccionario/traducciones-posibles.ts`
- Test: `tests/diccionario/traducciones-posibles.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `export function traduccionesPosibles(deLasAcepciones: string[][], deLaPalabra: string[][]): string[]`

**Qué hace.** Recibe las listas de traducciones de cada acepción y las listas de significados de cada grupo de la palabra, y devuelve **una sola lista sin repetidos**: primero todas las de acepción, después todas las de palabra.

**Por qué los cortos primero.** Los de acepción son equivalentes de una palabra (`orilla`, `banco`) y hacen mejor reverso de tarjeta; los de la palabra son definiciones enteras del Wikcionario español, con su punto final (`Banco.`, `Ranilla (sustancia córnea…)`).

**Cómo se comparan.** Sin distinguir mayúsculas ni espacios de sobra, para no ofrecer `Banco.` y `banco` como dos opciones. **Se conserva la primera forma que apareció**, no la normalizada: es la que se va a enseñar y a guardar.

- [ ] **Step 1: Escribe la prueba que falla**

Crea `tests/diccionario/traducciones-posibles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { traduccionesPosibles } from "@/lib/diccionario/traducciones-posibles";

describe("traduccionesPosibles", () => {
  /**
   * Los equivalentes cortos de una acepción hacen mejor reverso de tarjeta que
   * una definición entera del Wikcionario español, así que van delante.
   */
  it("pone primero las de las acepciones y después las de la palabra", () => {
    expect(traduccionesPosibles([["orilla"], ["banco"]], [["Banco.", "Reserva."]])).toEqual([
      "orilla",
      "banco",
      "Banco.",
      "Reserva.",
    ]);
  });

  it("junta varias acepciones y varios grupos en una sola lista", () => {
    expect(
      traduccionesPosibles([["a", "b"], ["c"]], [["d"], ["e", "f"]]),
    ).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  /**
   * Sin esto la lista ofrecería "Banco." y "banco" como si fueran dos opciones
   * distintas, y el usuario tendría que elegir entre dos cosas iguales.
   */
  it("quita repetidos sin distinguir mayúsculas ni espacios de sobra", () => {
    expect(traduccionesPosibles([["banco"], ["  BANCO  "]], [["Banco"]])).toEqual(["banco"]);
  });

  /** Se enseña y se guarda la forma que venía, no la normalizada. */
  it("conserva la primera forma que apareció", () => {
    expect(traduccionesPosibles([["Orilla"]], [["orilla"]])).toEqual(["Orilla"]);
  });

  it("descarta las vacías y las que solo traen espacios", () => {
    expect(traduccionesPosibles([["", "  ", "banco"]], [[""]])).toEqual(["banco"]);
  });

  it("sin ninguna traducción devuelve lista vacía", () => {
    expect(traduccionesPosibles([], [])).toEqual([]);
    expect(traduccionesPosibles([[], []], [[]])).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta la prueba para verla fallar**

Ejecuta: `npx vitest run tests/diccionario/traducciones-posibles.test.ts`
Esperado: FALLA con `Failed to resolve import "@/lib/diccionario/traducciones-posibles"`.

- [ ] **Step 3: Escribe el módulo**

Crea `lib/diccionario/traducciones-posibles.ts`:

```ts
/**
 * Todas las traducciones al español que se le pueden ofrecer a una palabra, en
 * una sola lista y sin repetidos.
 *
 * El usuario la pidió así, revuelta, cuando se le preguntó expresamente si
 * prefería ver las de una acepción junto a su acepción: quiere una lista y
 * elegir él, porque como profesor de idiomas sabe qué traducción va con qué
 * sentido mejor de lo que ninguna regla podría adivinar.
 *
 * **Las de acepción van primero.** Son equivalentes de una palabra —`orilla`,
 * `banco`— y hacen mejor reverso de tarjeta; las de la palabra son definiciones
 * enteras del Wikcionario español, con su punto final. Lo más parecido a una
 * traducción, arriba.
 *
 * La comparación ignora mayúsculas y espacios de sobra para no ofrecer `Banco.`
 * y `banco` como dos opciones distintas, pero **se conserva la primera forma que
 * apareció**: es la que se enseña y la que acaba en la tarjeta.
 */
export function traduccionesPosibles(
  deLasAcepciones: string[][],
  deLaPalabra: string[][],
): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];

  for (const grupo of [...deLasAcepciones, ...deLaPalabra]) {
    for (const cruda of grupo) {
      const traduccion = cruda.trim();
      if (!traduccion) continue;
      const clave = traduccion.toLowerCase().replace(/\s+/g, " ");
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      lista.push(traduccion);
    }
  }

  return lista;
}
```

- [ ] **Step 4: Ejecuta la prueba para verla pasar**

Ejecuta: `npx vitest run tests/diccionario/traducciones-posibles.test.ts`
Esperado: PASA, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint .
git add lib/diccionario/traducciones-posibles.ts tests/diccionario/traducciones-posibles.test.ts
git commit -m "Unir en una lista todas las traducciones posibles de una palabra"
```

---

### Task 2: Las funciones puras de la elección

**Files:**
- Modify: `components/BuscadorDiccionario.tsx`
- Modify: `tests/buscador-diccionario.test.ts`

**Interfaces:**
- Consumes: `traduccionesPosibles` de `@/lib/diccionario/traducciones-posibles`.
- Produces:
  - `export function entradaParaGuardar(acepcion: Acepcion, traduccion: string, nivel: string): { term: string; pos: string; gloss: string; example: string | null; translation: string; level: string }`
  - `export function botonAnadirDeshabilitado(acepcion: Acepcion | null, traduccion: string, nivel: string, enCurso: boolean): boolean` — **cambia de firma**
  - `export function botonAfinarDeshabilitado(acepcion: Acepcion | null, enCurso: boolean): boolean`
  - `export function conTraduccionesAfinadas(lista: string[], afinadas: string[]): string[]`
- Se retiran: `etiquetaDeOrigen` y `significadosDeLaAcepcion`, con sus `describe`.

**El tipo `Acepcion`** ya existe en el fichero (línea 15) con `id`, `term`, `pos`, `gloss`, `example`, `translations`, `yaGuardada`. **Expórtalo**: las funciones nuevas lo reciben.

- [ ] **Step 1: Comprueba que las dos funciones que se van no las usa nadie más**

```bash
grep -rn "etiquetaDeOrigen\|significadosDeLaAcepcion" --include='*.ts' --include='*.tsx' . | grep -v node_modules
```

Esperado: solo `components/BuscadorDiccionario.tsx` y `tests/buscador-diccionario.test.ts`. **Si aparece cualquier otro fichero, para y reporta BLOCKED**: significaría que la pantalla de extraer las usa y borrarlas la rompería.

- [ ] **Step 2: Escribe las pruebas que fallan**

En `tests/buscador-diccionario.test.ts`, borra los `describe` de `etiquetaDeOrigen` y `significadosDeLaAcepcion` y el `describe` viejo de `botonAnadirDeshabilitado`, y añade:

```ts
const acepcion = {
  id: 1,
  term: "bank",
  pos: "noun",
  gloss: "An edge of a river.",
  example: "They sat on the bank.",
  translations: ["orilla"],
  yaGuardada: false,
};

describe("entradaParaGuardar", () => {
  /**
   * El significado inglés elegido es lo que se guarda como pista, y es lo único
   * que distingue `bank`→orilla de `bank`→banco en la biblioteca.
   */
  it("guarda el significado elegido como pista, no otro", () => {
    const e = entradaParaGuardar(acepcion, "orilla", "B2");
    expect(e.gloss).toBe("An edge of a river.");
    expect(e.pos).toBe("noun");
    expect(e.example).toBe("They sat on the bank.");
  });

  it("guarda la traducción elegida, venga de donde venga", () => {
    expect(entradaParaGuardar(acepcion, "ribera", "B2").translation).toBe("ribera");
  });

  it("recorta la traducción escrita a mano", () => {
    expect(entradaParaGuardar(acepcion, "  ribera  ", "B2").translation).toBe("ribera");
  });

  it("guarda el nivel elegido", () => {
    expect(entradaParaGuardar(acepcion, "orilla", "C1").level).toBe("C1");
  });
});

describe("botonAnadirDeshabilitado", () => {
  /** Las tres elecciones son obligatorias: sin una de ellas no hay tarjeta que guardar. */
  it("hacen falta significado, traducción y nivel", () => {
    expect(botonAnadirDeshabilitado(null, "orilla", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "   ", "B2", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "", false)).toBe(true);
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "B2", false)).toBe(false);
  });

  /**
   * Con la petición en vuelo se deshabilita: dos toques mandarían dos POST antes
   * de que la pantalla se entere del primero.
   */
  it("con la petición en vuelo, deshabilitado", () => {
    expect(botonAnadirDeshabilitado(acepcion, "orilla", "B2", true)).toBe(true);
  });
});

describe("conTraduccionesAfinadas", () => {
  /**
   * Lo que devuelve el botón de pago va delante: es la traducción curada de la
   * acepción concreta que el usuario eligió, así que es la mejor de la lista.
   */
  it("mete lo afinado al principio", () => {
    expect(conTraduccionesAfinadas(["banco", "Banco."], ["orilla"])).toEqual([
      "orilla",
      "banco",
      "Banco.",
    ]);
  });

  it("no duplica lo que ya estaba", () => {
    expect(conTraduccionesAfinadas(["banco"], ["Banco", "orilla"])).toEqual(["orilla", "banco"]);
  });

  it("sin nada afinado deja la lista como estaba", () => {
    expect(conTraduccionesAfinadas(["banco"], [])).toEqual(["banco"]);
  });
});

describe("botonAfinarDeshabilitado", () => {
  /**
   * Afinar pide a Claude la traducción de UNA acepción concreta: sin significado
   * elegido no hay nada que afinar, y es el único botón que cuesta dinero.
   */
  it("hace falta un significado elegido", () => {
    expect(botonAfinarDeshabilitado(null, false)).toBe(true);
    expect(botonAfinarDeshabilitado(acepcion, false)).toBe(false);
  });

  it("con la petición en vuelo, deshabilitado", () => {
    expect(botonAfinarDeshabilitado(acepcion, true)).toBe(true);
  });
});
```

Actualiza los imports del fichero: fuera `etiquetaDeOrigen` y `significadosDeLaAcepcion`, dentro `entradaParaGuardar` y `botonAfinarDeshabilitado`.

- [ ] **Step 3: Ejecuta las pruebas para verlas fallar**

Ejecuta: `npx vitest run tests/buscador-diccionario.test.ts`
Esperado: FALLA por importaciones que no existen y por la firma vieja de `botonAnadirDeshabilitado`.

- [ ] **Step 4: Escribe las funciones**

En `components/BuscadorDiccionario.tsx`, exporta el tipo `Acepcion` (hoy está sin exportar, línea 15), borra `etiquetaDeOrigen` y `significadosDeLaAcepcion`, sustituye `botonAnadirDeshabilitado` y añade las dos nuevas:

```ts
/**
 * La tarjeta que entra en la biblioteca con lo que el usuario ha elegido.
 *
 * `gloss` es el significado inglés elegido, y es **lo único que distingue dos
 * acepciones de la misma palabra**: `bank`→orilla de `bank`→banco. Se guarda
 * como `senseHint` y es media clave de deduplicación de la biblioteca.
 */
export function entradaParaGuardar(
  acepcion: Acepcion,
  traduccion: string,
  nivel: string,
): {
  term: string;
  pos: string;
  gloss: string;
  example: string | null;
  translation: string;
  level: string;
} {
  return {
    term: acepcion.term,
    pos: acepcion.pos,
    gloss: acepcion.gloss,
    example: acepcion.example,
    translation: traduccion.trim(),
    level: nivel,
  };
}

/**
 * Las tres elecciones son obligatorias: significado, traducción y nivel. Sin
 * cualquiera de ellas no hay tarjeta que guardar, y guardarla a medias
 * produciría un reverso en blanco o una acepción sin distinguir.
 *
 * `enCurso` evita el doble toque que mandaría dos `POST /api/terms` antes de que
 * la pantalla se entere del primero.
 */
export function botonAnadirDeshabilitado(
  acepcion: Acepcion | null,
  traduccion: string,
  nivel: string,
  enCurso: boolean,
): boolean {
  return !acepcion || !traduccion.trim() || !nivel || enCurso;
}

/**
 * Afinar pide a Claude una traducción curada de **una acepción concreta**, así
 * que sin significado elegido no hay nada que afinar. Es el único botón de toda
 * la aplicación que cuesta dinero, y por eso también se bloquea mientras su
 * petición está en vuelo.
 */
export function botonAfinarDeshabilitado(acepcion: Acepcion | null, enCurso: boolean): boolean {
  return !acepcion || enCurso;
}

/**
 * La lista de traducciones tras afinar. Lo afinado va **al principio**: es lo
 * único que costó dinero y lo único curado para la acepción concreta que el
 * usuario eligió, así que es la mejor opción que hay.
 *
 * Reutiliza `traduccionesPosibles` para no repetir la regla de deduplicación:
 * si un día cambia cómo se comparan dos traducciones, cambia en un solo sitio.
 */
export function conTraduccionesAfinadas(lista: string[], afinadas: string[]): string[] {
  return traduccionesPosibles([afinadas], [lista]);
}
```

- [ ] **Step 5: Ejecuta las pruebas para verlas pasar**

Ejecuta: `npx vitest run tests/buscador-diccionario.test.ts`
Esperado: PASA. El componente todavía no compila porque su JSX usa las funciones retiradas — lo arregla la tarea 3. **`npx tsc --noEmit` fallará aquí, y es lo esperado.**

- [ ] **Step 6: Commit**

```bash
npx vitest run tests/buscador-diccionario.test.ts tests/diccionario/
git add components/BuscadorDiccionario.tsx tests/buscador-diccionario.test.ts
git commit -m "Las tres elecciones del diccionario: significado, traducción y nivel"
```

No ejecutes la suite entera ni `tsc` en este commit: el componente queda a medias hasta la tarea 3. **Si prefieres que todo compile siempre, junta esta tarea y la 3 en un solo commit al final de la 3.**

---

### Task 3: La pantalla

**Files:**
- Modify: `components/BuscadorDiccionario.tsx` (el componente)

**Interfaces:**
- Consumes: todo lo de las tareas 1 y 2, más `buscarTermino`, `anadirAcepcion`, `afinarConIA`, `cuandoTocaRepasar` y `avisoSinAcepciones`, que no cambian.
- Produces: nada nuevo exportado.

**La pantalla, según la especificación §4.** Una sola tarjeta por palabra:

- **Arriba, «Ya en tu repaso»**, como está hoy. No se toca.
- **«Traducciones al español»**: la lista de `traduccionesPosibles`, cada una un botón de radio. Y **siempre una opción más al final: escribir otra**, con su campo de texto. Escribir en él la selecciona.
- **«Significados»**: las acepciones **numeradas desde 1**, cada una un radio, con su `gloss` y su `example` debajo en cursiva si lo hay. Una acepción **con `yaGuardada`** se pinta igual y numerada, **pero sin radio**, y dice «ya en tu repaso» — esconderla cambiaría la numeración entre visitas.
- **El nivel**, con el mismo `Campo` de opciones que hoy.
- **«Añadir»**, con `botonAnadirDeshabilitado`, y **«Afinar con IA»** con `botonAfinarDeshabilitado`, conservando el aviso de que cuesta unos céntimos.
- **Si no hay ninguna traducción de ningún origen**, dilo con esas palabras y deja solo la de escribirla a mano.
- Los avisos de `avisoSinAcepciones` se conservan tal cual.

**Al afinar**, lo que devuelva se añade **al principio** de la lista de traducciones y queda seleccionado.

**Al buscar otra palabra**, se limpian las tres elecciones: significado, traducción y lo escrito a mano. Una elección que sobreviva a una búsqueda nueva guardaría la traducción de la palabra anterior.

- [ ] **Step 1: Rehaz el componente**

Sigue el patrón que el fichero ya tiene: el componente **solo pinta y guarda estado**, y todo lo que puede fallar está arriba en funciones puras. Los estados que necesita son cuatro: la acepción elegida, la traducción elegida, lo escrito a mano y el nivel — más los de en-curso que ya existen.

La lista se arma con lo que ya viaja en la respuesta:

```tsx
const traducciones = conTraduccionesAfinadas(
  traduccionesPosibles(
    resultado.acepciones.map((a) => a.translations),
    resultado.significados.map((g) => g.meanings),
  ),
  afinadas,
);
```

Los dos bloques nuevos, para que no haya dudas de la forma:

```tsx
{/* Las traducciones: una lista de opciones, y siempre la de escribir otra.
    El usuario pidió elegir él, así que ninguna viene marcada de entrada. */}
<fieldset className="flex flex-col gap-2">
  <legend style={TEXTO_1} className="text-texto-suave">Traducciones al español</legend>
  {traducciones.map((t) => (
    <label key={t} className="flex items-start gap-2">
      <input
        type="radio"
        name="traduccion"
        checked={traduccionElegida === t && !manual.trim()}
        onChange={() => { setTraduccionElegida(t); setManual(""); }}
      />
      <span>{t}</span>
    </label>
  ))}
</fieldset>

{/* Escribir otra va fuera del fieldset de radios: es un campo con su propia
    etiqueta, y anidar un input dentro de un label de radio rompe el foco. */}
<Campo
  id="traduccion-a-mano"
  etiqueta="…o escribe otra"
  value={manual}
  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
    setManual(e.target.value);
    if (e.target.value.trim()) setTraduccionElegida("");
  }}
  ayuda="Si escribes algo aquí, se guarda esto en vez de la traducción elegida arriba."
/>

{/* Los significados, numerados desde 1. Los ya guardados se enseñan igual y en
    su sitio —esconderlos cambiaría la numeración entre visitas— pero sin radio. */}
<ol className="flex list-none flex-col gap-3">
  {resultado.acepciones.map((a, indice) => (
    <li key={a.id} className="flex items-start gap-2">
      {a.yaGuardada ? (
        <span aria-hidden className="w-4" />
      ) : (
        <input
          type="radio"
          name="significado"
          checked={acepcionElegida?.id === a.id}
          onChange={() => setAcepcionElegida(a)}
        />
      )}
      <div className="flex flex-col gap-1">
        <p>{indice + 1}. {a.gloss}</p>
        {a.example && <p className="italic text-texto-suave">{a.example}</p>}
        {a.yaGuardada && (
          <p style={TEXTO_1} className="text-texto-suave">Ya está en tu repaso.</p>
        )}
      </div>
    </li>
  ))}
</ol>
```

`TEXTO_1` ya existe en el fichero. `Campo` y `Boton` se importan como hasta ahora.

- [ ] **Step 2: Comprueba que compila y que la suite pasa**

```bash
npx vitest run --no-file-parallelism
npx tsc --noEmit
npx eslint .
npm run build
```

Esperado: **más de 612 pruebas**, y los tres últimos sin salida. `tsc` tiene que estar limpio ahora: es lo que demuestra que no queda ningún uso de las funciones retiradas.

- [ ] **Step 3: NO lo compruebes en el navegador**

No arranques ningún servidor: la aplicación pide contraseña y la comprobación visual la hace el usuario en su móvil. **Dilo en tu informe.**

- [ ] **Step 4: Commit**

```bash
git add components/BuscadorDiccionario.tsx
git commit -m "La pantalla del diccionario que deja elegir"
```

---

## Al terminar

1. **Ejecuta todo**: `npx vitest run --no-file-parallelism`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
2. **Repasa la especificación** de arriba abajo y comprueba que cada sección tiene su código.
3. **No hay migración ni carga.** Esta rama no toca la base de datos: dilo en el informe final, para que nadie busque un paso que no existe.
