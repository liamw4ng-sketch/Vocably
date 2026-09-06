# AppVocabulario — Fase 2: repaso espaciado y rediseño

**Fecha:** 2026-09-06
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**Fase 1 (terminada):** `docs/superpowers/plans/2026-09-06-fase-1-extraccion.md`

## 1. Qué es

La fase 1 dejó una app que extrae vocabulario de un PDF y lo guarda. Funciona y el
material que produce es útil: 44 términos extraídos de un libro real, a unos
0,003 € por término.

Pero **nada obliga a repasarlo**, y sin repaso el vocabulario no se adquiere. Esta
fase construye lo que convierte ese almacén en aprendizaje: sesiones diarias de
repetición espaciada. Y aprovecha para vestir la aplicación, que hasta ahora usa
los estilos por defecto.

**No consume API.** Toda la fase 2 es cálculo local. Extraer seguirá siendo lo
único que cuesta dinero.

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Rediseño | Dentro de esta fase | La pantalla de repaso se mira a diario; diseñarla después obligaría a rehacerla |
| Estética | Moderna y con color | Elección del usuario, advertido del riesgo de recargar con el uso diario |
| Motivación | Celebrar al terminar, sin rachas | Premia haber estudiado hoy, no haber estudiado siempre |
| Sin conexión | No hace falta | El usuario tiene datos; evita el problema de sincronizar respuestas en conflicto |
| Entrega de tarjetas | Cola completa + respuesta al vuelo | Responder es instantáneo y nada se pierde si la sesión se corta |
| Cálculo del algoritmo | En el servidor | Un cliente obsoleto o dos dispositivos a la vez corromperían la planificación |

## 3. La sesión de repaso

**Al abrir**, la app dice cuántas tarjetas tocan hoy. Si no toca ninguna, lo dice y
ofrece adelantar términos nuevos de la biblioteca: una acción explícita del usuario
que introduce otro lote de tarjetas nuevas por encima del tope del día. El tope es
un ritmo por defecto, no un muro; lo que nunca ocurre es que la app se lo salte
sola.

**La tarjeta.** La cara delantera muestra el término en inglés **dentro de su frase
original del libro**, con el término resaltado. El contexto es lo que fija la
palabra, así que se ve antes de recordar. Al voltear aparecen la traducción y el
ejemplo de uso.

**Cuatro botones**, cada uno mostrando cuándo volverá a aparecer la tarjeta:

| Botón | Significado |
|---|---|
| Otra vez | No la recordaba |
| Difícil | La recordé con esfuerzo |
| Bien | La recordé |
| Fácil | Inmediata |

Los plazos los calcula FSRS a partir del historial de **esa** tarjeta concreta, así
que cambian con el tiempo: una palabra acertada durante meses salta a un año.

**Tarjetas nuevas con tope diario.** 20 por defecto, configurable. Extraer 80
términos de golpe no debe convertirse en 80 tarjetas al día siguiente.

**Filtros de sesión:** por fuente y por tipo de término.

**Al terminar**, una animación breve y un resumen de lo repasado. Sin contador de
días seguidos y sin reproches por las ausencias.

**Si la sesión se corta** —una llamada, cerrar la pestaña, perder cobertura— al
volver se retoma donde estaba: las respuestas ya dadas están registradas.

## 4. Arquitectura

**Algoritmo:** `ts-fsrs`. No se implementa a mano: la planificación espaciada es un
problema resuelto y reescribirlo solo añade errores.

**Dos rutas nuevas:**

- `GET /api/repaso/cola` — devuelve la cola del día: tarjetas vencidas más
  tarjetas nuevas hasta el tope diario, respetando los filtros.
- `POST /api/repaso/respuesta` — registra una valoración.

**El servidor es la autoridad.** El cliente envía qué botón se pulsó; el servidor
ejecuta FSRS, actualiza `card_states` y añade una fila a `review_logs`. El cliente
nunca escribe fechas. La pantalla avanza de forma optimista sin esperar la
respuesta.

**Idempotencia.** Cada respuesta lleva un identificador único generado por el
cliente. Si un reintento reenvía la misma respuesta, el servidor la ignora.

Sin esto, un reintento aplicaría FSRS dos veces y mandaría la tarjeta a una fecha
equivocada. El fallo sería **invisible**: esa palabra simplemente dejaría de
aparecer cuando tocaba. Es el error más peligroso de esta fase porque no se
manifiesta como un error.

**Configuración en base de datos**, no en el navegador, para que el tope diario sea
el mismo en el Mac y en el móvil.

## 5. Datos

`card_states` y `review_logs` existen desde la fase 1 y se rellenan desde la
primera extracción. Los 44 términos actuales ya tienen su ficha.

El primer paso de la implementación es contrastar el tipo `Card` de la versión
instalada de `ts-fsrs` contra `db/schema.ts`. La regla, decidida de antemano para
que no haya que improvisar:

- **Campos que la librería tiene y el esquema no:** se añaden en una migración
  nueva, como columnas anulables o con valor por defecto, de modo que las 44 fichas
  existentes sigan siendo válidas sin tocarlas.
- **Campos que el esquema tiene y la librería no:** se dejan como están. No se
  borra nada: `card_states` y `review_logs` llevan datos reales desde la primera
  extracción.
- **En ningún caso** se regenera la tabla desde cero ni se vacían las fichas.

Se añade una tabla `settings` de una sola fila para el tope diario de tarjetas
nuevas.

## 6. Rediseño

**Un sistema visual compartido** —paleta, escala tipográfica, espaciados, botones y
campos— definido primero y aplicado a las tres pantallas. Es lo que distingue una
app diseñada de una ensamblada.

**Pantalla de repaso** (la protagonista): tarjeta centrada con tipografía grande,
y los cuatro botones **abajo, al alcance del pulgar**, con color propio cada uno:
rojo *Otra vez*, ámbar *Difícil*, verde *Bien*, azul *Fácil*. El color permite
acertar el botón sin leerlo.

**Pantalla de extracción:** pasos claros, barra de progreso real durante los lotes,
y el coste presentado como resultado, no como nota al pie.

**Biblioteca:** tarjetas legibles en vez de lista plana, filtros como botones,
edición sin sensación de fragilidad.

**Claro y oscuro, ambos definidos a propósito.** La app sigue la preferencia del
sistema.

**Instalable en el móvil:** manifiesto, icono, nombre y arranque a pantalla
completa.

**Accesibilidad de base:** contraste suficiente, áreas táctiles grandes, y que el
diseño aguante con el tamaño de letra del sistema aumentado.

**Fuera del rediseño, a propósito:** mascota, ilustraciones, sonidos y cualquier
animación más allá del volteo de la tarjeta y la celebración final. Lo que se ve
todos los días conviene que sea tranquilo.

## 7. Pruebas

Automáticas, sobre lo que puede fallar en silencio:

- **Planificación FSRS:** los plazos y estados resultantes de cada botón.
- **Cola del día:** trae lo vencido más las nuevas justas sin pasar del tope;
  respeta los filtros.
- **Idempotencia:** una respuesta repetida no se aplica dos veces.
- **Reanudación:** cortar a mitad y volver retoma donde estaba.
- **Migración de `card_states`,** si resulta necesaria: los datos existentes
  sobreviven.

**El diseño no se verifica con pruebas automáticas.** Se verifica enseñando al
usuario capturas en tamaño móvil y escritorio, en claro y en oscuro. No se da por
bueno hasta que él lo aprueba.

**Prueba de aceptación:** el usuario completa varias sesiones reales desde el
móvil, en días distintos, y comprueba que las tarjetas reaparecen cuando les toca.

## 8. Orden de construcción

1. **Sistema visual** — paleta, tipografía, espaciados, componentes base.
2. **Repaso** — cola, respuesta idempotente, FSRS, pantalla de sesión. Es lo que
   se usa a diario.
3. **Rediseño de extracción y biblioteca.**
4. **PWA instalable.**

## 9. Fuera de alcance

- Funcionamiento sin conexión y sincronización de respuestas
- Tarjetas de español a inglés (producción)
- Ejercicios más allá de las tarjetas: huecos, opción múltiple, escribir
- Audio y pronunciación
- Rachas, logros y notificaciones
- Estadísticas de progreso
- Compartir vocabulario con alumnos
