# Vocably — Extraer vocabulario de un PDF sin llamar a la IA

**Fecha:** 2026-09-09
**Estado:** especificado, sin implementar
**Enmendado:** 2026-09-10, tras medir contra la base real con la implementación
ya en el PR #4 — sobre un capítulo limpio de 8.520 palabras con suelo B2, de
453 sugerencias 243 eran "expresiones" como `not that`, `of his` o `the man`:
más de la mitad de la lista era paja. Se estrecha la decisión 2 (§3) y el
filtro de §7.2: solo los verbos frasales entran siempre; las expresiones pasan
a filtrarse por nivel, igual que las palabras sueltas.
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**Extracción actual (la que esto NO sustituye):** `docs/superpowers/plans/2026-09-06-fase-1-extraccion.md`
**El español del diccionario (de lo que esto se apoya):** `docs/superpowers/specs/2026-09-09-espanol-del-diccionario-design.md`

## 1. Qué es

Hoy, extraer vocabulario de un PDF cuesta dinero: el fichero se manda a Claude,
que lee las páginas, elige los términos que merecen la pena y los traduce. Es
bueno y es caro — 0,1553 $ en dos extracciones.

Esto añade **un segundo botón, gratis**, que hace el mismo trabajo con las piezas
que la aplicación ya tiene: el diccionario inglés, los significados en español, y
un listado de niveles del MCER que se carga por primera vez aquí.

**No sustituye a la extracción con IA.** Son dos caminos: la IA sigue siendo
mejor cuando quieres una lista corta y ya juzgada; este es el que puedes usar
todos los días sin mirar el gasto.

## 2. La pregunta que este diseño tuvo que responder

Sin IA no hay nadie que juzgue qué palabra merece la pena aprender. De un
capítulo salen **2.318 formas distintas** y casi todas ya las sabes.

La primera respuesta fue filtrar por frecuencia. **Está medido que no vale:**

| Tramo de frecuencia | Reparto por nivel |
|---|---|
| 5.000 – 20.000 | B2 39 % · B1 31 % · C1 12 % · **pero también A2 9 % y A1 2 %** |
| 1.000 – 5.000 | **ya un 19 % de B2** |

En la misma franja de frecuencia conviven palabras A1 y C2. Filtrar por
frecuencia cuela fáciles y esconde B2 corrientes.

**La respuesta buena es el nivel**, y existe un listado libre que lo da (§4).

## 3. Decisiones tomadas

Las cinco del usuario, en el orden en que se tomaron:

1. **El filtro es el nivel, con suelo que él elige.** Palabras sueltas: solo de
   su nivel para arriba.
2. **Los verbos frasales se ofrecen siempre**, tengan nivel o no. No lo tienen
   (§4), y son buena parte de lo que esta aplicación existe para aprender: el
   diccionario trae 20.012. *(Enmendado 2026-09-10: al principio la decisión
   incluía también las expresiones, pero medido contra la base real más de la
   mitad de lo que ese "siempre" dejaba pasar era ruido gramatical —`of his`,
   `the man`— y no vocabulario. Las expresiones se estrecharon a filtrarse por
   nivel, igual que las palabras sueltas: ver la Enmienda de cabecera y §7.2.)*
3. **Sus PDFs llevan texto**, no son escaneos. Sin esto el proyecto no existía:
   una biblioteca de extracción no lee imágenes.
4. **La lista de candidatas no sobrevive** a cerrar la pantalla. Él controla el
   volumen eligiendo pocas páginas cada vez, como ya hace. Sin tabla de sesiones.
5. **El PDF se lee en el navegador**, no en el servidor.

## 4. El listado de niveles

**CEFR-J Vocabulary Profile 1.5** (Tono Laboratory, Universidad de Estudios
Extranjeros de Tokio) más **Octanove Vocabulary Profile C1/C2 1.0**, publicados
juntos en `github.com/openlanguageprofiles/olp-en-cefrj`.

| Nivel | Entradas |
|---|---|
| A1 | 1.164 |
| A2 | 1.411 |
| B1 | 2.446 |
| B2 | 2.778 |
| C1 | 1.111 |
| C2 | 1.025 |

**9.935 entradas, 8.653 palabras distintas**, cada una con su categoría
gramatical. El grueso cae en B1–B2, que es donde está el usuario.

**Licencia, comprobada:** el CEFR-J se puede usar con fines comerciales y no
comerciales sin coste, citándolo; el copyright es de Tono Laboratory. El
complemento Octanove es CC BY-SA 4.0. Los dos exigen atribución y ninguno cobra:
encaja con el criterio de coste cero del proyecto. **La atribución va en el
README**, junto a la del volcado de Wikcionario.

**Su punto ciego, y es el mismo que el del Wikcionario español: no trae verbos
frasales.** De quince corrientes —`give up`, `take off`, `turn down`,
`come across`…— no está ninguno. Solo hay ocho entradas verbales de más de una
palabra, y son rarezas C1/C2 como `mull over` o `eke out`. Por eso la decisión 2
de §3: si el nivel decidiera solo, los verbos frasales desaparecerían de la
extracción.

## 5. Lo que se midió antes de decidir

Todo sobre un capítulo real —«A Scandal in Bohemia», 11.048 palabras—, no
estimado.

| Medida | Valor |
|---|---|
| Formas distintas | 2.318 |
| Con nivel del MCER | 1.280 |
| Candidatas si el suelo es B1 | 420 |
| **Candidatas si el suelo es B2** | **183** |
| Candidatas si el suelo es C1 | 35 |

**Y el hallazgo que quita un subsistema entero del plan: no hace falta
lematizador.**

| | |
|---|---|
| Formas que el diccionario resuelve tal cual | 1.786 de 2.318 (**77 %**) |
| **Formas de B2 en adelante que resuelve** | **179 de 183 (98 %)** |
| Formas con nivel que el diccionario no trae | 16 |

Wikcionario tiene ficha propia para las flexiones que importan —`abandoned`,
`running`, `ran`, `studied` están— y las que faltan (`children`, `went`,
`bigger`) son de palabras A1 que el filtro descartaría igual. Se pierden cuatro
candidatas de 183: `opulence`, `sandwiched`, `invariable`, `nerves`. **Es un
precio aceptable por no construir ni mantener un lematizador.**

Nota sobre las cifras: cuentan **formas**, no lemas. `abandon` y `abandoned` van
por separado, así que la lista real que verá el usuario es algo más corta de lo
que dice la tabla.

## 6. Datos

Una tabla nueva, hermana de las dos que ya existen:

```ts
export const cefrLevels = pgTable(
  "cefr_levels",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    /** Categoría ya traducida al vocabulario del proyecto (§6.1). */
    pos: text("pos").notNull(),
    /** A1 | A2 | B1 | B2 | C1 | C2. */
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

Unas 9.900 filas, del orden de 600 KB. La base va por 71 MB de los 512 gratis.

El cargador es un script hermano de los dos que ya existen y, como ellos, es
**idempotente por el índice único**: volver a cargarlo actualiza en vez de
duplicar. A diferencia del español, aquí no conviven dos orígenes en la misma
tabla, así que el choque sustituye y no fusiona.

### 6.1 Las categorías gramaticales no coinciden, y hay que traducirlas

El listado del MCER y el diccionario del proyecto nombran distinto lo mismo.
**Guardar la categoría cruda haría que ninguna palabra casara con su ficha del
diccionario**, que es justo lo que el filtro necesita.

| Listado MCER | Proyecto | Entradas |
|---|---|---|
| `noun` | `noun` | 4.925 |
| `adjective` | `adj` | 2.055 |
| `verb` | `verb` | 1.809 |
| `adverb` | `adv` | 825 |
| `pronoun` | `pron` | 83 |
| `preposition` | `prep` | 81 |
| `determiner` | `det` | 46 |
| `conjunction` | `conj` | 38 |
| `number` | `num` | 30 |
| `modal auxiliary`, `be-verb`, `do-verb`, `have-verb`, `infinitive-to` | `verb` | 32 |
| `interjection` | `intj` | 9 |

Quedan dos filas sueltas que el volcado trae mal: una con la categoría vacía y
otra que dice `vern`, evidente errata de `verb`. **`vern` se trata como verbo; la
vacía se descarta.** Las dos van comentadas en el cargador, porque un valor raro
sin explicación invita a "arreglarlo" mal dentro de seis meses.

### 6.2 Qué nivel se guarda en la tarjeta

`terms.level` no admite nulos, así que todo lo que se guarde necesita un valor.

- **Si la palabra tiene nivel**, se guarda el suyo. Es la mejora: hoy `level` es
  el que el usuario elige para el PDF entero, igual para todas sus palabras.
- **Si no lo tiene** —solo puede ser un verbo frasal, tras la enmienda de
  2026-09-10 a §7.2: palabras sueltas y expresiones sin nivel ya no llegan
  hasta aquí, el filtro las corta antes— se guarda **el suelo que él eligió**.
  Es exactamente lo que pasa hoy con todo, así que no empeora nada; y la
  pantalla dice cuáles llevan nivel medido y cuáles heredado (§8), para no
  fingir una precisión que no hay.

## 7. El flujo

### 7.1 En el navegador

Elige el PDF y un rango de páginas, con el formulario que ya existe. **El
selector de nivel de ese formulario cambia de significado**: hoy es «el nivel que
se le pone a todo lo extraído»; aquí pasa a ser **el suelo del filtro**. Es el
mismo control y la misma escala, así que no hay nada nuevo que aprender, pero la
etiqueta y el texto de ayuda tienen que decirlo, porque no significa lo mismo en
los dos botones.

El navegador:

1. Extrae el texto de esas páginas. **Es la única dependencia nueva de todo el
   proyecto**: `pdf-lib`, que ya está, recorta páginas pero no lee letras. El
   candidato es `pdfjs-dist`, que es el lector de PDF del propio navegador y
   funciona en el cliente. **El plan tiene que comprobar antes que nada cuánto
   pesa en el paquete que se descarga al móvil**, porque esta aplicación se abre
   desde el icono del teléfono y ahí un megabyte de más se nota. Si pesara
   demasiado, la salida es cargarlo solo al entrar en la pantalla de extraer, no
   en el arranque de la aplicación.
2. Lo parte en **palabras sueltas y en grupos contiguos de dos y tres palabras**.
   Los grupos son lo que encuentra verbos frasales y expresiones: no se intenta
   analizar la gramática, se consulta el diccionario, que ya sabe cuáles existen.
3. Guarda, por cada candidata, **la frase del libro en que apareció**. Es lo que
   el usuario pidió expresamente, y es el contexto de la tarjeta.
4. Manda al servidor las cadenas distintas con su frase.

**El PDF no sale del teléfono.** Lo que viaja son cadenas: **40 KB para cinco
páginas**, 324 KB para un capítulo entero, muy por debajo del límite de 4,5 MB
por petición de Vercel. Es también por lo que la extracción con IA tuvo que
trocear el PDF, y aquí ese problema no existe.

### 7.2 En el servidor

`POST /api/extraer-sin-ia` recibe las candidatas y devuelve las que pasan el
filtro. Por cada una consulta lo que ya está montado:

1. **El diccionario inglés** — significado, ejemplo, categoría. Lo que no esté,
   fuera: no hay nada que enseñar.
2. **El nivel** (`cefr_levels`).
3. **Los significados en español** (`spanish_meanings`), con la misma cadena que
   la pantalla del diccionario.
4. **La biblioteca** — lo que ya está guardado no se vuelve a ofrecer.

**El filtro**, con la decisión 1 y 2 de §3 *(enmendada 2026-09-10)*:

- **Palabras sueltas y expresiones**: entran si su nivel es igual o superior al
  suelo. Sin nivel, fuera.
- **Verbos frasales**: entran siempre, tengan nivel o no.

Las expresiones no siempre se filtraron por nivel. Medido sobre un capítulo
real de 8.520 palabras con suelo B2, de 453 sugerencias 243 eran "expresiones"
como `not that`, `of his` o `the man` — grupos de palabras que Wikcionario
registra igual que un verbo frasal, pero que son ruido gramatical, no
vocabulario que enseñar. Más de la mitad de la lista era paja. Consecuencia
conocida y aceptada: los frasales de relleno (`take it`, `do it`) sobreviven
igual, porque Wikcionario los registra como verbos.

**No se llama a MyMemory.** Traducir cientos de candidatas de golpe se comería la
cuota diaria de 5.000 caracteres en una extracción, que es justo el fallo que la
rama anterior arregló. Una candidata sin español se ofrece igual, y el usuario
tiene el campo de escribirlo a mano y el botón de afinar con IA, como en el
diccionario.

## 8. La pantalla

Una lista para marcar, **ordenada de más difícil a más fácil**: C2 primero,
A1 al final.

**Los verbos frasales y las expresiones van los primeros de todo**, por encima
del C2. Los frasales no tienen nivel *(enmendado 2026-09-10: las expresiones,
desde que el filtro se estrechó en §7.2, sí lo tienen — necesitan alcanzar el
suelo para llegar aquí)*, así que cualquier sitio que se les dé a ellos es una
decisión; esta es la honesta, porque son lo que el usuario más quiere y lo que
ninguna fuente gratuita sabe puntuar. Dentro de ese bloque van en el orden en
que aparecen en el texto, y no por nivel: agruparlos así es un criterio, no un
olvido (ver el comentario del `sort` en `db/repository/extraer.ts`).

Cada línea:

- **La palabra**, y si es verbo frasal o expresión, dicho.
- **La frase del libro donde salió**, que es lo que pidió el usuario.
- **Sus significados en español**, hasta cinco, con su origen como en el
  diccionario.
- **Su nivel**, y **si es medido o heredado del suelo** (§6.2).

Se marcan las que se quieren y se guardan de una vez. Nada se guarda sin tocarlo.

**Guardar es una sola petición**, no una por palabra: cuarenta marcadas no pueden
ser cuarenta viajes al servidor.

**Si no queda ninguna candidata** —porque el rango era corto, porque el suelo era
alto, o porque ya lo tienes todo— se dice cuál de las tres cosas ha pasado. Un
resultado vacío sin explicación es lo que hace pensar que la herramienta está
rota.

## 9. Pruebas

Lógica pura, fuera de la base, como el resto del proyecto (Vitest,
`environment: "node"`, sin jsdom):

- **Partir el texto** en palabras y grupos de dos y tres: puntuación, guiones,
  apóstrofos, mayúsculas, y que la frase de contexto sea la que contiene la
  palabra.
- **Traducir la categoría** del listado MCER a la del proyecto, incluidas las dos
  filas malas (`vern` y la vacía).
- **El filtro**: una palabra por debajo del suelo se cae; una por encima entra; un
  verbo frasal sin nivel entra igual; una que ya está en la biblioteca no se
  ofrece.
- **El nivel de la tarjeta**: medido cuando lo hay, el suelo cuando no.

Con PGlite, contra una base de verdad:

- La consulta del §7.2 con sus cuatro orígenes, y que **una candidata sin ficha en
  el diccionario no llega a la lista**.
- **Que no se llama al traductor**, ni una vez, en toda la extracción.
- Cargar dos veces el listado de niveles deja el mismo número de filas.

## 10. Fuera de alcance

- **Los escaneos.** Un PDF sin texto dentro no se puede procesar así. Se detecta y
  se dice; añadir reconocimiento óptico es otro proyecto.
- **Los verbos frasales con la partícula separada.** «gave it up» no se reconoce,
  porque las candidatas son grupos contiguos. Se aceptó a cambio de no analizar
  la gramática, que es mucho más frágil. «give up» seguido sí se reconoce.
- **Lematizar.** Medido en §5: no hace falta.
- **La extracción con IA.** No se toca. Sigue en `/api/extract`, con su coste y su
  criterio.
- **Traducir en masa con MyMemory** (§7.2).

## 11. Orden de construcción

1. La tabla `cefr_levels`, su migración y el cargador.
2. El módulo puro que parte el texto en candidatas con su frase.
3. La consulta y el filtro.
4. La ruta.
5. La lectura del PDF en el navegador.
6. La pantalla.

La migración se aplica a la base real **a mano, ejecutando el `.sql`**, no con
`drizzle-kit push`. Y tras cargar el listado, **comparar el total de filas contra
el fichero fuente, no solo contarlas**: en la carga anterior las filas cuadraban
y faltaban 25 significados.
