# Vocably

Extrae vocabulario en inglés de un PDF con la API de Claude y lo guarda para
repasarlo con repetición espaciada. Aplicación de un solo usuario, sin registro
ni cuentas: se entra con una única contraseña.

Diseño completo: `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`

## Cómo funciona, en corto

1. Se sube un PDF, se elige un rango de páginas y un nivel del MCER (A1–C2).
2. El recorte del PDF ocurre **en el navegador**: el PDF original nunca sale del
   equipo ni se guarda en ningún sitio. Se envían al servidor lotes de 5
   páginas cada vez.
3. Cada lote se manda a la API de Claude (modelo `claude-opus-5`), que
   devuelve vocabulario, verbos frasales y expresiones con traducción,
   contexto original y un ejemplo de uso.
4. Los términos se guardan en Postgres. Los términos repetidos entre
   extracciones se fusionan; una traducción editada a mano en la biblioteca no
   se pierde si el término vuelve a salir en una extracción posterior.

La pantalla de extracción vive en `/extraer`, la biblioteca en `/biblioteca`,
el repaso en `/repaso` y la búsqueda en el diccionario en `/diccionario`. Las
cuatro requieren sesión iniciada; `/` redirige directamente a `/extraer`.

## Repaso con repetición espaciada

La pantalla `/repaso` muestra, una tarjeta a la vez, las palabras que tocan
hoy, en tres grupos y en este orden: las que están **en curso** (falladas hace
minutos, en aprendizaje o reaprendizaje), las ya **aprendidas** que vencen hoy,
y por último las **nuevas** hasta el tope diario. Se pulsa (o se pulsa la barra espaciadora) para ver la traducción
y el ejemplo, y se valora con uno de cuatro botones — Otra vez / Difícil /
Bien / Fácil, también accesibles con las teclas 1-4 — que alimentan el
algoritmo de repetición espaciada FSRS (paquete `ts-fsrs`) y fijan cuándo
vuelve a tocar esa palabra.

**Esta pantalla no consume la API de Claude en ningún momento.** Sus dos rutas
— `GET /api/repaso/cola` y `POST /api/repaso/respuesta` — solo leen y escriben
en Postgres; no hacen ninguna llamada a Anthropic. Lo único que tiene coste en
toda la aplicación es la extracción de vocabulario desde un PDF (ver
"Coste" más abajo).

Cada respuesta se envía con un identificador propio (`answerId`) que la
convierte en idempotente: si la app se cierra a mitad de sesión y una
respuesta se reintenta al volver, no se duplica en el historial ni se cuenta
dos veces. El resultado queda escrito en la base de datos en el momento de
responder, así que cerrar la app y reabrirla no hace reaparecer una tarjeta
ya respondida en esa misma cola. (Si una tarjeta valorada "Otra vez" vuelve a
salir al cabo de unos minutos, es el comportamiento normal de FSRS —un paso
de aprendizaje corto—, no una tarjeta que haya "olvidado" su respuesta.)

### Los tres ajustes

La tabla `settings` (una sola fila) guarda los tres ajustes que el usuario
controla. Se tocan desde la pantalla previa del repaso — no hay una pantalla de
ajustes aparte. `newCardsPerDay` se guarda al salir de su campo, porque es un
ajuste permanente; `sessionSize` y `sessionMode` son la elección de esta sesión
y solo se guardan al empezar si "Recordar esta elección" está marcada.

- **`newCardsPerDay`** (20 por defecto): cuántas palabras nuevas entran al
  día cuando el tamaño de sesión es `0`. Es diario: se cuentan las
  introducciones ya registradas hoy (`review_logs` con `state = 0` desde la
  medianoche de Madrid) y se resta. Con un tamaño de sesión explícito este
  tope queda sin efecto (ver `sessionSize`).
- **`sessionSize`** (0 por defecto): cuántas palabras entran **en total** en
  cada sesión, contando juntas en curso, aprendidas y nuevas. **0 significa
  "las que toquen hoy"**, así que por defecto la app no recorta nada por su
  cuenta y manda el tope diario de nuevas de arriba. Con cualquier otro
  número manda ese número, incluso por encima del tope diario: pedir 30 da
  30, aunque `newCardsPerDay` solo dejara entrar 5 hoy.
- **`sessionMode`** (`mezcla` por defecto): de cuál colección salen las
  palabras. Los valores válidos son `no-aprendidas` (en curso y nuevas),
  `aprendidas` (ya aprendidas que venzan) o `mezcla` (en curso, aprendidas
  vencidas y nuevas). Con un tamaño de sesión mayor que 0, `aprendidas` y
  `mezcla` rellenan además lo que falte adelantando aprendidas que aún no
  vencían, la más próxima primero (nunca al azar, para no repetir lo mismo si
  se adelanta dos días seguidos); con 0 no se adelanta nada.

Cuando vencen más palabras aprendidas de las que caben en la sesión, se
**sortean**: cuáles entran se decide al azar, no por antigüedad ni por id, de
modo que ninguna palabra queda sistemáticamente al final de la cola. El sorteo
solo actúa cuando hay una decisión que tomar; si caben todas, el orden no se
toca.

Dos garantías del recorte:

- **Las que están en curso nunca se sortean, y van siempre las primeras.** Son
  las que acabas de fallar y el algoritmo quiere volver a preguntar en
  minutos. Con el tamaño de sesión a `0` (el valor de fábrica) entran todas
  seguro; con un tamaño explícito cuentan, como cualquier otra tarjeta, contra
  ese total.
- **Lo que queda fuera no se pierde:** sigue vencido y entra en la sesión
  siguiente. Al terminar, la pantalla dice cuántos repasos quedaron fuera del
  límite y ofrece seguir. Conviene mirarlo: un límite por debajo del ritmo
  diario acumula atrasos, y sin ese aviso lo haría en silencio.

### Instalable en el móvil

`app/manifest.ts` define un manifiesto de aplicación web (nombre "Vocably",
modo `standalone`, icono en `app/icon.png`). Desde un navegador móvil se puede
añadir a la pantalla de inicio y abrirse como una app independiente, sin la
barra del navegador. El `start_url` del manifiesto es **`/repaso`**: abrir la
app desde el icono lleva directamente al repaso del día, no a la extracción.

## Diccionario

Extraer de un PDF no es la única forma de meter vocabulario. La pantalla
`/diccionario` es la segunda puerta: se busca una palabra suelta y se añade a
la biblioteca con un botón, con la misma estructura que ya usa la app —
palabra, significado, ejemplo— y el nivel del MCER puesto a mano (sin nivel
elegido, el botón no guarda).

La búsqueda recorre cuatro escalones y se para en el primero que responde:

| # | Dónde busca | Tarda | Cuesta |
|---|---|---|---|
| 1 | La biblioteca del usuario | instantáneo | 0 € |
| 2 | La tabla del diccionario (cargada de Wikcionario, ver más abajo) | instantáneo | 0 € |
| 3 | El traductor MyMemory, solo si a la entrada le falta el español | ~1 s (5 s como mucho), y se guarda si la acepción es única | 0 € |
| 4 | Claude, solo si se pulsa "Afinar con IA" | ~3 s | unos céntimos |

Si el término ya está en la biblioteca, la pantalla abre con un bloque **"Ya
en tu repaso"** —la traducción guardada, el nivel y cuándo vuelve a tocar— y
esa acepción no se ofrece para añadirla otra vez; las demás sí. Una palabra
guardada que Wikcionario no trae sale ahí igualmente: decir que "no está en el
diccionario" algo que el usuario ya tiene sería mentira. `GET /api/diccionario` resuelve los escalones 1
a 3; **no llama a Claude nunca**. El escalón 4 vive aparte, en
`POST /api/diccionario/afinar`, precisamente para que se vea de un vistazo que
ninguna otra ruta del diccionario toca la API.

### La pista en inglés

Una palabra puede tener más de un significado que interesa guardar por
separado: *bank* es la orilla de un río y también donde se guarda el dinero.
El diccionario permite guardar las dos acepciones del mismo término,
distinguidas por una pista —su significado en inglés— guardada en la columna
`senseHint` de `terms`. El índice único de `terms` es ahora sobre
`(term_normalized, sense_hint)`, no solo sobre el término.

En el repaso, esa pista aparece pequeña bajo la palabra, en la cara delantera
de la tarjeta y recortada a una línea: dice lo bastante para distinguir *bank*
→ orilla de *bank* → banco sin chivar la traducción al español antes de
tiempo.

### La fuente "Diccionario"

Las palabras añadidas a mano desde `/diccionario` cuelgan de una fuente
llamada **"Diccionario"**, con 0 páginas y coste 0 €, creada la primera vez
que hace falta (`POST /api/terms`, vía `anadirDesdeDiccionario`). Así la
biblioteca puede filtrar entre lo buscado a mano y lo extraído de un PDF, sin
tener que tocar el esquema de `sources` para distinguirlos.

### El traductor

El diccionario en sí (ver "Cargar el diccionario" más abajo) trae español en
muy pocas entradas: solo el 1,8 % de lo cargado. El resto se traduce con
**MyMemory**, un servicio gratuito. Se manda solo el término suelto, nunca
pegado a su definición: probado a mano, pegarlos rompe la traducción (*"come
across: to give an impression"* vuelve como *"venir a través: para dar una
impresión"*, partiendo el verbo frasal en dos).

La traducción se guarda en su fila del diccionario **solo cuando el término
tiene una única acepción sin español**. Ahí, y solo ahí, la respuesta es de
verdad de esa acepción: al traductor se le manda el término suelto, así que lo
que vuelve es la traducción de la palabra, no la de un significado concreto.
Si hay varias acepciones sin español —*bank* tiene siete entradas—, la
traducción se enseña en todas pero no se cachea en ninguna: escribir "banco"
en la acepción de orilla y darla por buena la dejaría mal para siempre,
porque una fila cacheada no se vuelve a consultar. Preguntar otra vez es
gratis; equivocarse en la base, no.

La llamada se corta a los cinco segundos (`AbortSignal.timeout`). Un servicio
caído ya estaba cubierto, pero uno colgado dejaba esperando a la búsqueda
entera, que para entonces ya tiene el significado y el ejemplo listos para
enseñar. Si MyMemory no contesta, la ficha sale igual sin español y quedan dos
salidas: **escribir la traducción a mano** en la propia ficha, que es gratis y
es la que manda si se usa, o el botón "Afinar con IA", que cuesta unos
céntimos.

### Cargar el diccionario

La tabla `dictionary_entries` sale de un volcado de Wikcionario en inglés (vía
kaikki.org), filtrado a las categorías útiles —sustantivo, verbo, adjetivo,
adverbio, expresión, verbo frasal, interjección— y a las 50.000 palabras
sueltas más frecuentes del inglés; las expresiones de varias palabras
(verbos frasales, idioms) entran todas, sin filtro de frecuencia porque no
aparecen en ninguna lista de frecuencia. Resultado: **181.103 entradas, unos
36 MB** una vez en Postgres.

Cargarla es un paso manual que hace una persona **una vez**, igual que
`drizzle-kit push`: no forma parte del arranque de la app ni se repite en cada
despliegue, porque el diccionario no cambia. El fichero de datos
(`dicc_todo.jsonl.gz`) vive fuera de este repositorio.

```bash
DATABASE_URL='...' npm run cargar:diccionario -- ~/Vocably-diccionario/dicc_todo.jsonl.gz
```

El script vacía la tabla y la vuelve a llenar entera: para 181.103 filas es
más simple y más seguro que intentar fusionar fila a fila, y el diccionario es
material de consulta, no datos del usuario, así que no hay nada que perder al
recargarlo.

## En local

```bash
npm install
cp .env.example .env.local   # y rellenar las cuatro variables (ver más abajo)
DATABASE_URL='...' npx drizzle-kit push   # crea las tablas en tu Postgres
npm run dev                  # http://localhost:3000
```

`drizzle-kit push` no lee `.env.local` automáticamente (el proyecto no usa
`dotenv`), así que hay que pasarle `DATABASE_URL` explícitamente en el mismo
comando, tanto en local como contra producción.

### Variables de entorno

Todas son solo de servidor (no hay ninguna variable pública `NEXT_PUBLIC_*`).
Están descritas en `.env.example`:

| Variable | Para qué sirve |
|---|---|
| `ANTHROPIC_API_KEY` | Autentica las llamadas a la API de Claude que hacen la extracción. |
| `DATABASE_URL` | Cadena de conexión de Postgres (Neon). |
| `APP_PASSWORD` | La única contraseña con la que se entra a la app. |
| `SESSION_SECRET` | Firma la cookie de sesión. Debe ser una cadena larga y aleatoria. |

`SESSION_SECRET` **no tiene valor por defecto**, a propósito: si falta, la app
debe fallar de forma ruidosa en vez de arrancar con una firma predecible. Ahora
mismo ese fallo es un error genérico de Node, no un mensaje claro — si al
arrancar algo revienta de forma rara, comprueba primero que `SESSION_SECRET`
está definido.

`.env.local` está en `.gitignore`; nunca debe llegar a un commit.

La comprobación de `APP_PASSWORD` al entrar es una comparación normal de
cadenas (`!==`), que no es de tiempo constante, y no hay ningún límite de
intentos: nada impide probar contraseñas una detrás de otra. Para una app de un
solo usuario se acepta a cambio de no añadir estado ni dependencias, pero
obliga a que `APP_PASSWORD` sea **larga y aleatoria** (por ejemplo, la salida de
`openssl rand -hex 24`), no una contraseña adivinable.

## Pruebas

```bash
npm test
```

Ninguna prueba llama a la API de Claude ni toca la base de datos real: usan
respuestas grabadas y un Postgres en memoria (PGlite). Comandos útiles además
de `npm test`:

```bash
npx tsc --noEmit   # comprobación de tipos
npx eslint .        # estilo y errores comunes
```

## Detalles de la implementación que conviene no "corregir"

- La protección de rutas está en **`proxy.ts`**, no en `middleware.ts`. Es
  intencional: en esta versión de Next.js, `middleware.ts` se ejecuta siempre
  en el runtime Edge, que no soporta `node:crypto`, y la firma de la sesión lo
  necesita. Renombrarlo a `middleware.ts` rompería el login.
- La configuración de Vitest es `vitest.config.mts` (con extensión `.mts`, no
  `.ts`). Es a propósito: mantiene la salida de `npm test` libre de avisos.
- El acceso a Postgres usa el driver `neon-serverless` (con `Pool`), no
  `neon-http`. No son intercambiables aquí: `saveExtraction` necesita una
  transacción real para fusionar términos repetidos de forma atómica, y eso
  solo lo da `neon-serverless`.

## Despliegue en Vercel

Primer despliegue (base de datos nueva): crear una base gratuita en
[Neon](https://neon.tech) y copiar su cadena de conexión, importar este
repositorio en Vercel, definir en el proyecto las cuatro variables de
`.env.example` y aplicar `npx drizzle-kit push` una vez antes o justo después
del primer despliegue para crear todas las tablas.

Para desplegar esta fase (fase 2) sobre una base de datos que **ya existe y
tiene vocabulario real**, seguir estos pasos en orden:

### 1. Rotar las credenciales

Generar una API key nueva de Anthropic y una contraseña nueva para la base de
datos de Neon. Configurar ambas:

- En las variables de entorno del proyecto en el proveedor de hosting
  (Vercel): `ANTHROPIC_API_KEY` y `DATABASE_URL`.
- En `.env.local` para desarrollo local, con los mismos valores nuevos.

`.env.local` está en `.gitignore` y no debe llegar nunca a un commit.

### 2. Comprobación previa a la migración

La migración de esta fase añade a `review_logs` una columna `answer_id` que
es `NOT NULL` y **no tiene valor por defecto**. Si esa tabla ya tuviera filas,
la migración fallaría a mitad de camino. Antes de tocar nada, conectar con la
base de producción (por ejemplo desde el editor SQL de Neon, o con `psql`) y
ejecutar:

```sql
SELECT count(*) FROM review_logs;
```

Debe devolver **0**. Si devuelve cualquier otro número, **parar aquí y
preguntar** antes de seguir: significa que ya hay historial de repasos
guardado y la migración, tal como está escrita, lo rompería.

De paso, anotar también cuántos términos hay en la biblioteca, para poder
comprobar después de la migración que no se ha perdido ninguno:

```sql
SELECT count(*) FROM terms;
```

### 3. Aplicar la migración

Con la base de datos de Neon ya usando la contraseña nueva del paso 1:

```bash
DATABASE_URL='<cadena de Neon>' npx drizzle-kit push
```

Esto aplica las dos migraciones pendientes de una vez:
`drizzle/0001_adorable_boomerang.sql` crea la tabla `settings` y añade
`learning_steps` a `card_states` y `answer_id` a `review_logs`;
`drizzle/0002_little_yellowjacket.sql` añade `reviews_per_session` a
`settings`.
`drizzle-kit push` no lee `.env.local`, así que hay que pasarle
`DATABASE_URL` explícitamente en el propio comando, con la cadena de conexión
real de Neon.

### 4. Verificar que la migración funcionó

Comprobar que las columnas y la tabla nuevas existen:

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'card_states' AND column_name = 'learning_steps';
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'review_logs' AND column_name = 'answer_id';
SELECT to_regclass('public.settings');
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'reviews_per_session';
```

Las cuatro deben devolver una fila (la tercera, el nombre `settings` en vez de
`NULL`). Y comprobar que el vocabulario existente sigue intacto, comparando
con el número anotado en el paso 2:

```sql
SELECT count(*) FROM terms;
```

### 5. Desplegar

Con las variables de entorno del paso 1 ya actualizadas en Vercel, desplegar
esta rama (redeploy manual, o el push/merge que dispare el despliegue
automático).

## Coste

Dos operaciones de la app tienen coste, porque son las únicas que llaman a la
API de Claude: la extracción de vocabulario desde un PDF, y el botón "Afinar
con IA" de `/diccionario`, que el usuario pulsa a voluntad. Todo lo demás —
el repaso en `/repaso` (cargar la cola, responder tarjetas, cambiar los
ajustes) y la búsqueda en `/diccionario` (la biblioteca, la tabla del
diccionario y el traductor MyMemory, sus tres primeros escalones)— no llama a
Anthropic nunca y no añade coste, por muchas veces que se use.

Cada extracción muestra en la interfaz su coste real, calculado a partir de
los tokens que ha consumido esa llamada. El modelo es `claude-opus-5`: 5 $ por
millón de tokens de entrada y 25 $ por millón de tokens de salida.

**Medición real** (primera extracción contra un PDF propio, 2026-09-06): 26
términos por unos 0,07 €, es decir alrededor de 0,003 € por término. Mil
términos en la biblioteca costarían menos de 3 €. El diseño estimaba entre 15 y
30 céntimos por 7-8 páginas; la realidad ha salido aproximadamente la mitad de
cara.

"Afinar con IA" usa el mismo modelo y la misma fórmula de coste, pero por
palabra suelta en vez de por lote de páginas; en la pantalla no se muestra un
importe calculado, solo el aviso fijo "Afinar cuesta unos céntimos. Todo lo
demás de esta pantalla es gratis."

El botón desaparece en cuanto la acepción está guardada: afinar reescribe la
caché del diccionario, no la ficha ya creada en `terms`, así que pulsarlo
entonces cobraría por un cambio que la tarjeta de repaso no llegaría a ver.

## Prueba de aceptación

### Fase 1 (extracción y biblioteca)

La fase 1 no se considera terminada hasta comprobar, contra el despliegue real
y con un PDF propio, todo lo siguiente:

1. Entrar en la app desplegada con la contraseña.
2. Subir un PDF propio y pedir un rango corto con su nivel del MCER.
3. Comprobar que el vocabulario extraído es correcto y útil: los términos
   aparecen de verdad en esas páginas y las traducciones son correctas.
4. Comprobar que el coste mostrado es asumible.
5. Editar una traducción en la biblioteca.
6. Cerrar la app, volver a abrirla y comprobar que todo sigue ahí, con la
   corrección incluida.
7. Repetir la extracción del mismo rango y comprobar que los términos salen
   como "ya los tenías" y que la corrección no se ha perdido.

### Fase 2 (repaso)

La fase 2 no se considera terminada hasta que, en el móvil y en días
distintos (esto no se puede comprobar en una sola sesión de un tirón), se
verifique todo lo siguiente:

- [ ] Instalar la app en la pantalla de inicio y abrirla desde el icono.
- [ ] Completar una sesión entera con una mano, sin esperas entre tarjetas.
- [ ] Que al terminar, el resumen (Otra vez / Difícil / Bien / Fácil) cuadre
      con lo respondido durante la sesión.
- [ ] Cerrar la app a mitad de una sesión y volver a abrirla: lo ya
      respondido no debe reaparecer en la cola.
- [ ] **Al día siguiente:** que las palabras valoradas como "Otra vez"
      vuelvan a salir y las valoradas como "Fácil" no.
- [ ] Que el diseño resulte cómodo de usar tras varias sesiones, no solo
      bonito la primera vez.
- [ ] Poner "Cuántas", en la pantalla previa, en un número bajo (3, por
      ejemplo) y comprobar que la sesión trae ese número, que el aviso de lo
      que quedó fuera cuadra, y que "Seguir repasando" trae palabras distintas.
- [ ] Volver a ponerlo en 0 y comprobar que vuelven a entrar todas.

## Estado actual y limitaciones conocidas

- **Fase 1:** extracción desde PDF y biblioteca editable. Código completo y
  probado.
- **Fase 2 (repaso con repetición espaciada):** construida. Pantalla
  `/repaso` con su pantalla previa —qué colección y cuántas palabras, antes de
  ver la primera tarjeta—, algoritmo FSRS, los tres ajustes de la tabla
  `settings` (tope diario de palabras nuevas, tamaño de sesión y colección que
  se repasa), manifiesto para instalar la app en el móvil con `start_url` en
  `/repaso`. No consume la API de Claude en ningún momento (ver "Coste").
  Pendiente solo la prueba de aceptación de más arriba, que hace el usuario en
  su móvil.
- La suite completa suma **389 pruebas**, ninguna contra la API de Claude ni
  contra MyMemory ni contra una base de datos real.
- **No hay pruebas de componentes.** Vitest corre con `environment: "node"`,
  sin jsdom ni Testing Library, así que ninguna prueba puede pulsar un botón
  ni comprobar qué se pinta. Lo que se prueba de la interfaz son sus funciones
  puras (`lib/review-session.ts`, `guardarAjuste`). Dos fallos reales de esta
  fase —el campo del tope que se quedaba deshabilitado y el bloque de ajustes
  que desaparecía al terminar la sesión— solo aparecieron conduciendo un
  navegador a mano.
- Si `SESSION_SECRET` falta, el fallo al arrancar es un error genérico de
  Node, no un mensaje claro pensado para esto.
