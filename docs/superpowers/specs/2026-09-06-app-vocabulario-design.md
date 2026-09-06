# AppVocabulario — Diseño

**Fecha:** 2026-09-06
**Estado:** aprobado en brainstorming, pendiente de plan de implementación

El plan de implementación que sigue a este documento cubre **solo la fase 1**. Las fases 2
y 3 tendrán el suyo propio, escrito cuando la anterior esté en uso.

## 1. Qué es

Una aplicación web personal para adquirir vocabulario en inglés a partir de PDF.

Automatiza un flujo que hoy se hace a mano copiando un prompt en un chat: se le da un
PDF, un rango de páginas y un nivel del MCER, y devuelve el vocabulario, los verbos
frasales y las expresiones de ese nivel con traducción, el contexto original y un
ejemplo de uso. Ese vocabulario queda guardado y se repasa con repetición espaciada.

**Un solo usuario.** Sin registro, sin roles, sin alumnos.

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Alcance | Extraer **y** repasar | El objetivo es adquirir vocabulario, no producir tablas |
| Plataforma | Web desplegada, con móvil | El repaso ocurre en huecos muertos, fuera del escritorio |
| Extracción | API de Claude | Es lo único que entiende contexto: verbos frasales y expresiones |
| Usuarios | Solo el propietario | Menos código, antes en las manos del usuario |
| Repaso | Repetición espaciada (FSRS) | El método con más respaldo para memoria a largo plazo |
| PDF de entrada | Texto y escaneados | Claude lee texto e imágenes de la página en una sola pasada |
| Despliegue | Vercel, plan gratuito | Cero mantenimiento; solo se paga la API |

## 3. Arquitectura

Una sola aplicación **Next.js (App Router) + TypeScript + Tailwind**, desplegada en
Vercel: interfaz y rutas de servidor en el mismo proyecto y el mismo despliegue.

| Pieza | Tecnología | Papel |
|---|---|---|
| Base de datos | Postgres en Neon, acceso con Drizzle | Vocabulario y estado de repaso |
| Extracción | `@anthropic-ai/sdk`, modelo `claude-opus-5` | Convierte páginas en términos |
| Recorte de PDF | `pdf-lib`, en el navegador | Aísla el rango de páginas antes de subirlo |
| Repetición espaciada | `ts-fsrs` | Calcula la próxima fecha de cada tarjeta |
| Acceso | Cookie de sesión firmada | Contraseña única, sin cuentas |
| Móvil | Manifiesto PWA | Instalable en la pantalla de inicio |

**El PDF nunca se almacena.** Se recorta en el navegador, se envía el trozo, se extrae
y se descarta. No hay gestión de archivos ni almacenamiento de libros.

### Límites que condicionan el diseño

- Vercel corta las funciones de servidor a los 60 s. Por eso la extracción va por lotes.
- La API acepta 32 MB y 600 páginas por petición, muy por encima de lo que enviamos.
- El cuerpo de una petición a una función de Vercel está limitado a 4,5 MB. Recortar el
  PDF en el navegador mantiene los envíos muy por debajo.

## 4. Modelo de datos

Cinco tablas. La idea que las ordena: **el término y su progreso viven separados**, para
poder corregir una traducción sin perder el historial de repaso de esa palabra.

**`sources`** — cada extracción realizada.
`id`, `title`, `page_start`, `page_end`, `level`, `created_at`,
`input_tokens`, `output_tokens`, `cost_usd`.

Los tres últimos guardan el consumo real para poder mostrar el coste medido.

**`terms`** — el vocabulario, una fila por término único.
`id`, `term`, `term_normalized` (único), `type` (`word` | `phrasal_verb` | `expression`),
`translation`, `level`, `created_at`, `updated_at`.

`term_normalized` es el término en minúsculas, sin espacios sobrantes: es la clave que
detecta duplicados.

**`term_occurrences`** — dónde ha aparecido cada término.
`id`, `term_id`, `source_id`, `context`, `example`.

Un término que sale en dos unidades tiene dos apariciones y **una sola tarjeta**.

**`card_states`** — el estado FSRS de cada término.
`term_id` (clave primaria), `due`, `stability`, `difficulty`, `elapsed_days`,
`scheduled_days`, `reps`, `lapses`, `state`, `last_review`.

**`review_logs`** — histórico de respuestas.
`id`, `term_id`, `rating`, `state`, `stability`, `difficulty`, `reviewed_at`.

No se usa en la fase 2, pero registrarlo desde el principio permite optimizar los
parámetros de FSRS más adelante. Borrarlo después sería perder datos irrecuperables.

## 5. Extracción

### Flujo

1. El usuario arrastra un PDF, escribe el rango de páginas y elige el nivel del MCER.
2. El navegador extrae ese rango con `pdf-lib`. El archivo original no sale del equipo.
3. El rango se divide en **lotes de 5 páginas**.
4. Los lotes se envían **en secuencia** a `POST /api/extract`.
5. Cada lote que responde **se guarda de inmediato** y aparece en pantalla.
6. Al terminar, el vocabulario está en la biblioteca, editable.

El guardado por lotes es deliberado: si el lote de las páginas 16-20 falla, las páginas
anteriores ya están guardadas y solo se reintenta el trozo roto.

### La petición a Claude

- Modelo `claude-opus-5`, pensamiento adaptativo (`thinking: {type: "adaptive"}`).
- Las páginas van como bloque `document` en base64, antes del bloque de texto. Claude
  lee texto e imágenes de cada página, de modo que un PDF escaneado y uno digital
  siguen el mismo camino, sin detección previa.
- Respuesta con salida estructurada (`output_config.format`): un array de objetos con
  `term`, `type`, `translation`, `context`, `example`. Nunca hay que interpretar una
  tabla de texto.
- Se llama con `.stream()` y `.finalMessage()`, con `max_tokens: 16000`.

El prompt reproduce la instrucción del usuario y añade dos reglas que evitan invenciones:

- El término debe aparecer literalmente en las páginas enviadas.
- `context` debe ser una frase copiada del texto, no redactada.

### Duplicados

Antes de insertar, se busca `term_normalized`:

- **No existe** → se crea el término, su aparición y su tarjeta.
- **Ya existe** → se añade solo la aparición. La tarjeta y su progreso quedan intactos.
  El `level` y la traducción conservan los valores de la primera vez; la extracción nueva
  aporta contexto y ejemplo, no reescribe lo que el usuario pueda haber corregido a mano.

Ver la misma palabra dos veces desde cero es una de las causas típicas de abandono.

### Errores

| Situación | Comportamiento |
|---|---|
| Rango fuera del PDF | Se avisa antes de enviar nada |
| PDF cifrado o ilegible | Se avisa al recortar, sin gastar API |
| Fallo de la API o de red | Se reintenta solo ese lote, a petición del usuario |
| Un lote no devuelve términos | Se registra y se continúa; no interrumpe el resto |

### Coste

Se muestra el consumo real de cada extracción, tomado de `usage` en la respuesta.

Estimación previa, a confirmar con datos: entre 15 y 30 céntimos por 7-8 páginas, según
sean de texto limpio o escaneadas. `claude-opus-5` cuesta 5 $/millón de tokens de
entrada y 25 $/millón de salida.

Si el coste medido resulta alto, la palanca es cambiar de modelo; la decisión es del
usuario y se toma con los números delante, no por adelantado.

## 6. Repaso

**La sesión.** La app indica cuántas tarjetas tocan hoy. La cara delantera muestra el
término en inglés dentro de su frase original, con el término resaltado: el contexto es
lo que fija la palabra, así que se ve antes de recordar, no después. Al voltear aparecen
la traducción y el ejemplo.

**Los cuatro botones** de FSRS: Otra vez, Difícil, Bien, Fácil. `ts-fsrs` calcula la
siguiente fecha y actualiza `card_states`; la respuesta se anota en `review_logs`.

**Dirección:** inglés → español (reconocimiento). La dirección inversa es un ejercicio
distinto y queda fuera de esta versión.

**Tope de tarjetas nuevas:** 20 al día, configurable. Extraer 80 términos de una vez no
debe convertirse en 80 tarjetas al día siguiente.

**Filtros:** se puede repasar solo una fuente o solo un tipo de término.

**Sin rachas ni penalizaciones.** Un contador de lo pendiente y nada más.

## 7. Biblioteca

Lista buscable de todo el vocabulario, con filtro por fuente, nivel y tipo. Cualquier
campo es editable y cualquier término se puede borrar. Editar un término no altera su
estado de repaso; borrarlo elimina también su tarjeta y sus apariciones.

## 8. Acceso

Una contraseña definida en la variable de entorno `APP_PASSWORD`. Al acertarla se emite
una cookie de sesión firmada, `httpOnly`, con caducidad larga. Un middleware protege
todas las rutas salvo la de entrada. No hay correo, registro ni recuperación.

`ANTHROPIC_API_KEY` y `DATABASE_URL` viven como variables de entorno en Vercel y solo se
usan en el servidor.

## 9. Pruebas

Automáticas, con Vitest, sobre las cuatro cosas que pueden fallar en silencio:

- **Programación FSRS** — las fechas y los estados resultantes de cada valoración.
- **Detección de duplicados** — normalización, fusión de apariciones, progreso intacto.
- **Recorte del PDF** — que el rango extraído sea exactamente el pedido, incluidos los
  límites (primera página, última, rango de una sola página) y los rangos inválidos.
- **Lectura de la respuesta de Claude** — con respuestas grabadas como ficheros de
  prueba. Las pruebas no llaman a la API ni gastan dinero.

**Prueba manual obligatoria antes de cerrar la fase 1:** una extracción real con un PDF
propio del usuario. Si el vocabulario resultante no le sirve, la fase no está terminada.

## 10. Fases

**Fase 1 — Extraer y guardar.** Entrada, subida y recorte del PDF, extracción por lotes,
guardado automático, biblioteca editable, coste medido.
*Terminada cuando:* el usuario extrae vocabulario de un PDF suyo, lo encuentra correcto y
sigue estando ahí al volver a abrir la app.

**Fase 2 — Repasar.** Estado FSRS, cola diaria, sesión de repaso, tope de tarjetas
nuevas, filtros, PWA instalable.
*Terminada cuando:* el usuario completa varias sesiones desde el móvil y las tarjetas
reaparecen cuando les toca.

**Fase 3 — Ajustes.** Se define al usar las dos primeras. Candidatos: dirección inversa,
tipos de ejercicio, exportar a Anki, estadísticas.

## 11. Fuera de alcance

Descartado a propósito, para que la app llegue a existir:

- Varios usuarios, alumnos, roles o compartir listas
- Guardar los PDF originales
- Tarjetas de español a inglés
- Audio, pronunciación o imágenes
- Rachas, insignias y notificaciones
- Aplicación móvil nativa
- Ejercicios más allá de las tarjetas
