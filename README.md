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

La pantalla de extracción vive en `/extraer`, la biblioteca en `/biblioteca` y
el repaso en `/repaso`. Las tres requieren sesión iniciada; `/` redirige
directamente a `/extraer`.

## Repaso con repetición espaciada

La pantalla `/repaso` muestra, una tarjeta a la vez, las palabras que tocan
hoy: primero las vencidas y, hasta el tope diario, palabras nuevas de la
biblioteca. Se pulsa (o se pulsa la barra espaciadora) para ver la traducción
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

Cuántas palabras nuevas al día se introducen es configurable: la tabla
`settings` (una sola fila) guarda `newCardsPerDay`, con 20 por defecto. Se
ajusta desde un campo en la propia pantalla de repaso, en la tarjeta de
resumen que aparece al terminar la sesión — no hay una pantalla de ajustes
aparte.

### Instalable en el móvil

`app/manifest.ts` define un manifiesto de aplicación web (nombre "Vocably",
modo `standalone`, icono en `app/icon.png`). Desde un navegador móvil se puede
añadir a la pantalla de inicio y abrirse como una app independiente, sin la
barra del navegador. El `start_url` del manifiesto es **`/repaso`**: abrir la
app desde el icono lleva directamente al repaso del día, no a la extracción.

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

Esto crea la tabla `settings` y añade `learning_steps` a `card_states` y
`answer_id` a `review_logs` (migración `drizzle/0001_adorable_boomerang.sql`).
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
```

Las tres deben devolver una fila (la tercera, el nombre `settings` en vez de
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

La única operación de la app que tiene coste es la extracción de vocabulario
desde un PDF (la llamada a la API de Claude). El repaso en `/repaso` —
cargar la cola, responder tarjetas, ajustar el tope de tarjetas nuevas— no
llama a Anthropic nunca y por tanto no añade coste, por muchas sesiones que
se hagan al día.

Cada extracción muestra en la interfaz su coste real, calculado a partir de
los tokens que ha consumido esa llamada. El modelo es `claude-opus-5`: 5 $ por
millón de tokens de entrada y 25 $ por millón de tokens de salida.

**Medición real** (primera extracción contra un PDF propio, 2026-09-06): 26
términos por unos 0,07 €, es decir alrededor de 0,003 € por término. Mil
términos en la biblioteca costarían menos de 3 €. El diseño estimaba entre 15 y
30 céntimos por 7-8 páginas; la realidad ha salido aproximadamente la mitad de
cara.

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

## Estado actual y limitaciones conocidas

- **Fase 1:** extracción desde PDF y biblioteca editable. Código completo y
  probado.
- **Fase 2 (repaso con repetición espaciada):** construida. Pantalla
  `/repaso`, algoritmo FSRS, tope diario de tarjetas nuevas configurable
  (tabla `settings`), manifiesto para instalar la app en el móvil con
  `start_url` en `/repaso`. No consume la API de Claude en ningún momento
  (ver "Coste"). Pendiente solo la prueba de aceptación de más arriba, que
  hace el usuario en su móvil.
- La suite completa suma **160 pruebas**, ninguna contra la API de Claude ni
  contra una base de datos real.
- Si `SESSION_SECRET` falta, el fallo al arrancar es un error genérico de
  Node, no un mensaje claro pensado para esto.
