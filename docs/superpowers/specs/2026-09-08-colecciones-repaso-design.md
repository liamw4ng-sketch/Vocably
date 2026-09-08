# Vocably — Elegir qué y cuánto repasar antes de empezar

**Fecha:** 2026-09-08
**Estado:** implementado en la rama `colecciones-repaso`
**Enmendado:** 2026-09-08 — lo que cambió al construirlo va marcado abajo con
*(enmienda)*.
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**Fase 2 (el repaso que esto modifica):** `docs/superpowers/specs/2026-09-06-fase-2-repaso-design.md`

## 1. Qué es

Hoy `/repaso` entra directo en la primera carta. No hay forma de decir cuántas
palabras quieres hacer ni de qué tipo: la sesión es la que la aplicación decida.

El ajuste existe —`reviewsPerSession`, en `components/SesionRepaso.tsx`— pero solo
se pinta en dos pantallas: cuando **no** toca ninguna tarjeta y cuando **ya has
terminado**. Es decir, en los dos únicos momentos en los que no sirve de nada. Si
hoy hay palabras pendientes, no hay dónde tocarlo; solo puedes cambiarlo al acabar,
para la próxima vez.

Esto añade **una pantalla previa** en la que se elige, antes de empezar, de qué
colección salen las tarjetas y cuántas quieres.

## 2. Decisiones tomadas

Las cuatro que fijan el resto, todas del usuario:

1. **Pantalla previa cada vez, con memoria.** Sale siempre, rellenada con lo que
   guardaste la última vez. Puedes cambiarlo solo por hoy o marcar que se recuerde.
2. **Las colecciones las decide el algoritmo**, no un botón. No hay un «ya me la
   sé»: una palabra sube a «aprendidas» al acertarla y baja sola al fallarla.
3. **Elegir una colección puede adelantar palabras que aún no vencían**, y lo que
   respondas cuenta como cualquier otro repaso. Es lo que ya hace el botón
   «Adelantar palabras nuevas», extendido a las aprendidas.
4. **El número elegido manda sobre el tope diario de palabras nuevas.** Si pides 30
   te da 30, aunque el tope solo dejara entrar 5.

Y una consecuencia que conviene dejar escrita: como el número es un total de
sesión y `reviewsPerSession` limitaba solo los repasos, **los dos no pueden
convivir**. El viejo se sustituye (§7).

## 3. Las dos colecciones

No hay concepto nuevo que guardar: se derivan del estado que FSRS ya escribe en
`card_states.state`.

| Colección | Estados FSRS | Qué es en cristiano |
|---|---|---|
| **No aprendidas** | `New` (0), `Learning` (1), `Relearning` (3) | Las que nunca has visto y las que estás peleando ahora mismo |
| **Aprendidas** | `Review` (2) | Las que superaste y están programadas para volver |

Una palabra fallada pasa a `Relearning` y por tanto baja sola a «no aprendidas»;
vuelve a subir cuando la aciertes.

`getDueQueue` ya separa hoy esos tres grupos internamente y ya los llama `nuevas`,
`enCurso` y `aprendidas`. Lo único que falta es exponerlos.

**Las «en curso» cuentan como no aprendidas, sin excepción.** Si eliges
«Aprendidas» no se cuelan, aunque las hayas fallado hace diez minutos y el
algoritmo las quiera ya. Predecible antes que listo: una colección que a veces
trae cosas de la otra deja de ser una colección.

## 4. La pantalla previa

Un estado nuevo en `components/SesionRepaso.tsx`, antes del actual `lista`:

```
Hoy tienes 23 palabras
5 sin aprender · 18 aprendidas

Repasar:  [ No aprendidas ]  [ Aprendidas ]  [ Mezcla ]
Cuántas:  [ 20 ]
[ ] Recordar esta elección

            [ Empezar ]
```

- El modo y el número vienen rellenados con lo guardado. El `20` del boceto es un
  ejemplo de valor recordado; de fábrica son `mezcla` y `0`.
- La casilla, sin marcar, hace que la elección valga **solo para esta sesión**.
  Marcada, guarda modo y número como los nuevos valores por defecto.
- Debajo de cada modo se dice cuántas hay disponibles, contando las que se pueden
  adelantar: elegir un modo vacío tiene que ser imposible, no una sorpresa.
- Si la biblioteca está vacía del todo, la pantalla lo dice y enlaza a `/extraer` y
  `/diccionario` en vez de ofrecer un botón que no puede hacer nada.

Esta pantalla **sustituye** a la de «Hoy no toca ninguna tarjeta»: aquel caso ahora
es simplemente una pantalla previa en la que los contadores de hoy están a cero y
todo lo que se ofrece es adelantar.

**No siempre hay algo que adelantar.** *(enmienda, 2026-09-08.)* Con toda la
biblioteca en aprendizaje y todavía sin vencer —lo que deja una sesión respondida
entera con "Otra vez"— los totales también están a cero, y entonces ofrecer un
número es ofrecer algo que no puede pasar: los tres modos salen a (0) y "Empezar"
en gris. Ese estado se dice aparte («las que estás aprendiendo vuelven en unos
minutos»), y no se confunde ni con estar al día ni con no tener vocabulario.

## 5. La regla del número

Es lo único con letra pequeña, así que va sola y se explica en la propia pantalla:

- **`0` = «las que toquen hoy».** Comportamiento actual: solo lo vencido, y las
  nuevas respetan el tope diario. La aplicación no recorta por su cuenta.
- **Cualquier otro número = exactamente ese.** Si lo vencido no llega, se adelantan
  palabras que aún no tocaban hasta completarlo, y el tope diario de nuevas no
  se aplica.

Lo que respondas cuenta siempre y reprograma la palabra con normalidad, en los dos
casos. No hay modo práctica.

**Cómo se compone la sesión**, dado un modo y un número `n > 0`:

| Modo | Orden de relleno |
|---|---|
| No aprendidas | en curso → nuevas |
| Aprendidas | aprendidas vencidas → aprendidas por vencer |
| Mezcla | en curso → aprendidas vencidas → nuevas → aprendidas por vencer |

Se recorta al llegar a `n`. Con `n = 0` se toman todos los grupos vencidos enteros
y las nuevas hasta el tope, y no se adelanta nada.

Si agotados todos los grupos del modo no se llega a `n`, la sesión es más corta y ya
está: no se toca la otra colección para rellenar. Pedir 30 «aprendidas» cuando solo
tienes 12 en toda la biblioteca da 12. La pantalla previa ya enseña cuántas hay, así
que el número no sale de la nada.

**El sorteo solo actúa donde hay que elegir**, igual que hoy. Si de un grupo vencido
caben todas, el orden no se toca. Si hay que dejar fuera, se sortean con `barajar`,
que ya existe. Las **adelantadas** son la excepción: se toman por fecha de
vencimiento, la más próxima primero. Adelantar al azar sería adelantar dos veces
lo mismo.

**Lo que queda fuera se cuenta en dos números, no en uno.** *(enmienda,
2026-09-08.)* El diseño original hablaba de un solo `repasosFuera`, contando los
repasos vencidos que se quedaron fuera. Al construirlo se vio que eso deja
invisible la otra mitad: el modo también descarta colecciones enteras —"aprendidas"
no cuela ninguna palabra en curso y "no aprendidas" ningún repaso—, así que una
palabra fallada hace diez minutos y ya vencida podía quedarse fuera sin que nadie
la contara, y la pantalla felicitaba por haber terminado. `componerSesion` devuelve
ahora `repasosFuera` (aprendidas vencidas) y `enCursoFuera` (en curso vencidas),
medidos igual: lo que estaba en el grupo y no acabó en la sesión. Van separados
porque de ellos depende **a qué colección lleva el botón de seguir**, y ningún modo
trae las dos: un solo total diría cuántas quedan pero no dónde buscarlas, y un botón
que va a la equivocada devuelve una sesión vacía. La pantalla los suma para decidir
si enseñar el aviso, y los mira por separado para elegir el modo. Sigue valiendo el
motivo de contarlos: un tamaño de sesión por debajo del ritmo diario acumula atrasos
en silencio hasta que la cola es impagable.

## 6. Arquitectura

**`lib/repaso/coleccion.ts`** — nuevo, lógica pura, sin base de datos. Es donde
vive toda la decisión y donde va el grueso de las pruebas.

`Modo` **no vive aquí sino en `lib/ajustes.ts`** (§7), y este módulo lo importa de
allí. Al revés no puede ser: `lib/ajustes.ts` lo carga el navegador, y este módulo
importa tipos de `db/repository/review.ts`; basta un despiste que convierta ese
import de tipos en uno de valores para arrastrar drizzle al paquete del cliente,
que es justo lo que el comentario de `lib/ajustes.ts` lleva pidiendo que no pase.

```ts
import type { Modo } from "@/lib/ajustes";

/** A qué colección pertenece una carta, según su estado FSRS. */
export function coleccionDe(state: number): "no-aprendidas" | "aprendidas";

export type Grupos = {
  enCurso: CartaCola[];
  nuevas: CartaCola[];
  aprendidasVencidas: CartaCola[];
  /** Ya ordenadas por `due` ascendente. */
  aprendidasFuturas: CartaCola[];
};

export function componerSesion(
  grupos: Grupos,
  opciones: { modo: Modo; cuantas: number; limiteNuevas: number },
): CartaCola[];
```

`limiteNuevas` es el cupo diario que queda, y **solo se aplica cuando
`cuantas === 0`**: con un número explícito manda el número (§2, decisión 4). Pasarlo
siempre y decidir dentro mantiene la función pura y deja la regla en un solo sitio,
en vez de repartirla entre la función y quien la llama.

**`db/repository/review.ts`** — `OpcionesCola` gana `modo` y `cuantas`. El cambio
grande no es la consulta sino **qué se descarta**: hoy una carta que no ha vencido
y no es nueva se cae del bucle sin entrar en ningún grupo. Para poder adelantar
aprendidas hay que recogerlas en `aprendidasFuturas` en vez de tirarlas. `adelantar`
desaparece: la pantalla previa lo cubre, y dos mecanismos para lo mismo es el
enredo que §2 evita.

**`GET /api/repaso/resumen`** — nuevo. Cuenta, sin construir la cola:

```ts
type ResumenColecciones = {
  hoy: { sinAprender: number; aprendidas: number };
  total: { sinAprender: number; aprendidas: number };
};
```

`hoy` es lo vencido, que es lo que se enseña en grande. `total` incluye lo
adelantable, y es lo que decide si un modo se puede elegir.

**`GET /api/repaso/cola`** — pierde `adelantar`, gana `modo` y `cuantas`.

**`components/SesionRepaso.tsx`** — un estado `"antes"` antes de `"lista"`. El
control de ajustes que hoy solo aparece al final se mueve aquí, que es donde el
usuario lo buscaba. Las funciones puras (`puedeEmpezar`, `resumenLegible`) se
exportan y se prueban, como el resto del proyecto.

## 7. Datos

Una migración. `settings` cambia:

```sql
ALTER TABLE "settings" ADD COLUMN "session_size" integer DEFAULT 0 NOT NULL;
ALTER TABLE "settings" ADD COLUMN "session_mode" text DEFAULT 'mezcla' NOT NULL;
ALTER TABLE "settings" DROP COLUMN "reviews_per_session";
```

`newCardsPerDay` **se queda**: sigue gobernando el ritmo cuando el número es `0`,
que es el valor por defecto y el caso de quien entra sin pensar.

**Sobre el `DROP COLUMN`:** la tabla `settings` de producción está vacía (0 filas,
comprobado el 2026-09-08), así que no se pierde ningún valor del usuario; el
defecto de `reviewsPerSession` era `0`, que además es el defecto del nuevo
`sessionSize`. Aun así es una sentencia con pérdida de datos y `drizzle-kit push`
va a pedir confirmación: hay que aplicarla a mano y mirando, no en un guion.

`lib/ajustes.ts` —que a propósito no importa nada de la base de datos, para no
arrastrar drizzle al paquete del navegador— cambia `MAXIMO_REPASOS_POR_SESION` por
`MAXIMO_TAMANO_SESION` (mismo valor, 500) y pasa a ser **el sitio donde se define
`Modo`**, junto a `MODOS: readonly Modo[]`, que valida la ruta y rellena los botones.
Una sola fuente para servidor y cliente, y sin nada de la base de datos detrás.

`app/api/ajustes/route.ts` valida `sessionMode` contra esa lista y `sessionSize`
contra el máximo, con el mismo patrón de error en español que ya usa.

## 8. Pruebas

`environment: "node"`, sin jsdom, como todo el proyecto.

**`lib/repaso/coleccion.ts`** — el grueso, sin base de datos:
- `coleccionDe` para los cuatro estados FSRS.
- Los tres modos con material de sobra: sale lo que dice la tabla de §5 y nada más.
- El número manda: `n` menor que lo vencido recorta; `n` mayor adelanta hasta
  completar; `n = 0` no adelanta nunca.
- El tope diario de nuevas se respeta con `n = 0` y se ignora con `n > 0`.
- Las adelantadas salen por fecha, la más próxima primero.
- Modo con su colección vacía: devuelve lista vacía, no revienta ni se cuela nada
  de la otra.

**`db/repository/review.ts`**, contra PGlite:
- Una aprendida que aún no vence **entra** con `modo=aprendidas` y `n > 0` —la
  prueba de regresión del comportamiento que hoy la tira— y **no entra** con `n = 0`.
- `repasosFuera` sigue contando lo vencido que quedó fuera.

**`app/api/repaso/resumen`** — los contadores de `hoy` y `total` distinguen vencido
de adelantable.

**Manual, al final:** entrar en `/repaso`, comprobar que los tres modos dan lo que
prometen y que la casilla de recordar se nota en la sesión siguiente.

## 9. Orden de construcción

1. `lib/repaso/coleccion.ts` con sus pruebas. Sin tocar nada más: si la composición
   no está bien, lo demás no importa.
2. La migración y `db/repository/settings.ts`.
3. `getDueQueue`: recoger las aprendidas futuras y delegar en `componerSesion`.
4. `GET /api/repaso/resumen` y los parámetros nuevos de `/api/repaso/cola`.
5. La pantalla previa en `SesionRepaso.tsx`, y mover ahí el control de ajustes.
6. Prueba manual.

## 10. Fuera de alcance

- **Un botón «ya me la sé»**: descartado a propósito en §2. Las colecciones las
  llena el algoritmo.
- **Un número por colección**: un solo total, más simple de entender.
- **Reorganizar `/biblioteca`** por colecciones. Puede tener sentido después; no
  entra aquí.
- **Un modo práctica que no afecte al calendario**: descartado en §2, decisión 3.
- Lo que quedó pendiente del diccionario —el `git push` de `f7b43df` y que
  `crearTraductorMyMemory` no mira `quotaFinished`— es aparte y sigue pendiente.
