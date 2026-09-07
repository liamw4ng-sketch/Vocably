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

La pantalla de extracción vive en `/extraer` y la biblioteca en `/biblioteca`.
Ambas requieren sesión iniciada; `/` redirige directamente a `/extraer`.

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

1. Crear una base de datos gratuita en [Neon](https://neon.tech) y copiar su
   cadena de conexión (`DATABASE_URL`).
2. Importar este repositorio en Vercel.
3. Definir en el proyecto de Vercel las cuatro variables de `.env.example`.
   `SESSION_SECRET` debe ser una cadena larga y aleatoria (por ejemplo, la
   salida de `openssl rand -hex 32`); `APP_PASSWORD` es la contraseña con la
   que se entra.
4. Aplicar las migraciones contra la base de producción, antes o justo después
   del primer despliegue:
   ```bash
   DATABASE_URL='<cadena de Neon>' npx drizzle-kit push
   ```
5. Desplegar.

## Coste

Cada extracción muestra en la interfaz su coste real, calculado a partir de
los tokens que ha consumido esa llamada. El modelo es `claude-opus-5`: 5 $ por
millón de tokens de entrada y 25 $ por millón de tokens de salida.

**Medición real** (primera extracción contra un PDF propio, 2026-09-06): 26
términos por unos 0,07 €, es decir alrededor de 0,003 € por término. Mil
términos en la biblioteca costarían menos de 3 €. El diseño estimaba entre 15 y
30 céntimos por 7-8 páginas; la realidad ha salido aproximadamente la mitad de
cara.

## Prueba de aceptación

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

## Estado actual y limitaciones conocidas

- **Fase 1 (esta):** extracción desde PDF y biblioteca editable. Código
  completo y probado (77 pruebas).
- **Fase 2 (repaso con repetición espaciada):** no está construida todavía.
  Las tablas `card_states` y `review_logs` ya existen en el esquema y se
  rellenan durante la extracción, pero nada las lee ni las usa aún — no se
  perderá ningún dato cuando se implemente el repaso.
- Si `SESSION_SECRET` falta, el fallo al arrancar es un error genérico de
  Node, no un mensaje claro pensado para esto.
