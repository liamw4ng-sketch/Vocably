# Vocably — Diccionario: buscar palabras a mano y añadirlas

**Fecha:** 2026-09-07
**Estado:** implementado y fundido en `main` el 2026-09-08 (commit `fd2b5d6`)
**Enmendado:** 2026-09-08 — dos decisiones cambiaron durante la implementación y
están marcadas abajo con *(enmienda)*. Lo que queda sin construir está en §12.
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**Fase 2 (terminada):** `docs/superpowers/specs/2026-09-06-fase-2-repaso-design.md`
**Datos ya medidos y descargados:** `/Users/yijun/Vocably-diccionario/` (ver su `LEEME.md`)

## 1. Qué es

Hoy el vocabulario solo puede entrar por una puerta: extraerlo de un PDF con la API
de Claude. Si la usuaria oye una palabra en clase, la lee en un artículo o quiere
comprobar una acepción, no tiene dónde meterla.

Esto añade la segunda puerta: **una pantalla `/diccionario` donde se busca un
término y se añade a la biblioteca con un botón**, con la misma estructura que ya
usa la aplicación —palabra, significado, ejemplo— y el nivel del MCER puesto a mano.

**No consume API.** El significado y el ejemplo salen de un fichero de Wikcionario
que se carga una vez; la traducción, de un traductor gratuito. Claude solo
interviene si la usuaria pulsa un botón, y ese botón es opcional. Extraer de un PDF
sigue siendo lo único que cuesta dinero.

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Fuente del diccionario | Wikcionario en inglés, vía el volcado de kaikki.org | Cubre palabras, verbos frasales e idioms; licencia libre |
| Significado | **En inglés** | Es donde Wikcionario es bueno; traducir definiciones da español torpe (medido) |
| Traducción al español | Un traductor gratuito, cacheado solo cuando no hay ambigüedad *(enmienda, §8)* | Wikcionario solo trae español en el 1,8 % de las entradas |
| Nivel del MCER | Lo pone la usuaria al guardar | Depende de la acepción y del criterio del profesor; es lo que peor haría una IA |
| Papel de Claude | Un botón opcional de "afinar" | Criterio de la usuaria: que salga gratis |
| Dónde vive el diccionario | **Postgres** | 36 MB sobre 500 MB gratis; evita inventar un sistema de trozos y su cargador |
| Varias acepciones del mismo término | Sí, distinguidas por una pista en inglés | Permite guardar *bank* como orilla y como banco sin chivar la respuesta |
| Procedencia de lo buscado a mano | Una fuente llamada "Diccionario" | La biblioteca ya filtra por fuente; no hay que tocar el esquema para esto |

## 3. La pantalla

**`/diccionario`**: un campo de búsqueda y los resultados. Nada más. Requiere sesión
iniciada, como el resto.

La búsqueda recorre cuatro escalones y para en el primero que responde:

| # | Dónde busca | Tarda | Cuesta |
|---|---|---|---|
| 1 | La biblioteca de la usuaria | instantáneo | 0 € |
| 2 | La tabla del diccionario | instantáneo | 0 € |
| 3 | El traductor, solo si falta el español | ~1 s; se guarda solo si no hay ambigüedad *(enmienda, §8)* | 0 € |
| 4 | Claude, solo si la usuaria pulsa "afinar" | ~3 s | céntimos partidos |

**Si el término ya está en la biblioteca**, sale marcado como *"ya está en tu
repaso"*, con la traducción guardada y cuándo toca repasarlo. No se ofrece añadirlo
otra vez, salvo que sea una acepción distinta de las que ya tiene.

**Si es nuevo**, sale una ficha por acepción, con:

- el **significado en inglés**;
- un **ejemplo** de uso corriente;
- la **traducción al español**;
- un campo para **escribir la traducción a mano** *(enmienda)*;
- un selector de **nivel del MCER, sin valor por defecto**;
- un botón **Añadir**.

Sin nivel elegido, el botón no guarda: obligar a elegir es lo que evita una
biblioteca llena de niveles inventados.

**El campo de traducción a mano** *(enmienda, 2026-09-08)* no estaba en el diseño
original y se añadió al construirlo. Sin él, una palabra que el traductor no supiera
resolver —porque el servicio esté caído, o porque no tenga esa entrada— solo se podía
añadir pulsando el botón que cuesta dinero. Eso contradice el criterio de la usuaria,
que es que el diccionario salga gratis. Si escribe algo en ese campo, es lo que se
guarda; si no, se guarda lo que traiga el traductor. Y le sirve además como profesora:
muchas veces la traducción que quiere en la tarjeta la sabe ella mejor.

**Estilo:** los tokens y componentes del sistema visual de la fase 2, sin añadir
capas decorativas. La usuaria pidió expresamente mantener las pantallas simples.

## 4. El diccionario

### Qué se carga

Un subconjunto de Wikcionario en inglés, ya descargado, filtrado y medido el
2026-09-07 a partir del volcado de kaikki.org del 28-08-2026 (3,2 GB). **El volcado
original no se guarda**: se filtra al vuelo mientras se descarga.

| | |
|---|---|
| Entradas leídas | 1.487.639 |
| **Entradas guardadas** | **181.103** |
| **Ocupa** | **35,8 MB** (10,8 MB comprimido) |
| Con traducción al español | 3.318 — **1,8 %** |

El filtro, reproducible con `filtrar.py`:

- Solo inglés, y solo categorías útiles: sustantivo, verbo, adjetivo, adverbio,
  expresión, verbo frasal, interjección. Fuera nombres propios, símbolos, prefijos
  y sufijos.
- **Palabras sueltas:** solo las 50.000 más frecuentes del inglés real.
- **Expresiones de varias palabras:** todas, sin filtro de frecuencia. Son los
  verbos frasales y los idioms, que no aparecen en ninguna lista de frecuencia.
- Fuera las acepciones obsoletas, arcaicas, dialectales, las erratas y las formas
  flexionadas.
- De cada acepción: significado, un ejemplo de uso corriente —descartando las citas
  literarias— y las traducciones al español que Wikcionario traiga, **enganchadas a
  su acepción** cuando el volcado dice a cuál pertenecen.

**Un arreglo pendiente del filtro**, detectado al comprobar los resultados:
**2.749 entradas basura** con glosas del tipo *"Used other than figuratively or
idiomatically: see come, across"*. Salen como primera acepción de varios verbos
frasales y no le sirven de nada a la usuaria. Se quitan con una regla más. El resto
de lo comprobado sale limpio.

### Cómo se carga

Un script que se ejecuta una vez contra la base de datos, igual que
`drizzle-kit push`. No forma parte del arranque de la aplicación ni se repite en
cada despliegue: el diccionario no cambia.

## 5. La búsqueda

La clave de búsqueda es el término normalizado con `normalizeTerm`, el mismo que ya
deduplica los términos extraídos: minúsculas, sin espacios sobrantes, NFC.

**Variantes del lema.** Wikcionario lemmatiza los idioms con *one*, no con *you*:
la ficha de *bite off more than you can chew* está guardada como
**`bite off more than one can chew`**. Buscar la forma natural no encuentra nada.
La búsqueda prueba, en orden, la forma escrita y sus variantes intercambiando
`you` ↔ `one`, `your` ↔ `one's`, `someone` ↔ `somebody`. Es un fallo real,
comprobado, no una precaución teórica.

**Varias fichas por palabra.** Una palabra puede tener varias entradas, una por
etimología. *bank* tiene siete: la financiera, la de orilla (*"An edge of river,
lake, or other watercourse"*), la de hilera… Se muestran todas, agrupadas por
categoría gramatical. Cada ficha trae hasta seis acepciones, que es el máximo que
guarda el filtro.

## 6. Arquitectura

Tres rutas, dos de ellas nuevas:

- **`GET /api/diccionario?q=`** (nueva) — la búsqueda de los escalones 1 y 2, y el 3
  si falta el español. Devuelve las fichas con una marca de si el término ya está en
  la biblioteca. No llama a Claude nunca.
- **`POST /api/terms`** (nueva) — añadir una acepción a la biblioteca: crea el
  término con su nivel y su pista, la aparición colgada de la fuente "Diccionario" y
  la ficha en `card_states`. Hoy `app/api/terms/route.ts` solo tiene `GET`.
- **`POST /api/diccionario/afinar`** (nueva) — el único punto que cuesta dinero.
  Aislada a propósito: así se ve de un vistazo que ninguna otra ruta llama a la API.

El cálculo y las llamadas a servicios externos ocurren **en el servidor**, como el
resto de la aplicación.

## 7. Datos

**Tabla nueva `dictionary_entries`.** Una fila por acepción: término normalizado,
término tal cual, categoría gramatical, significado en inglés, ejemplo,
traducciones al español, y de dónde salió la traducción (Wikcionario, el traductor
o Claude). Índice sobre el término normalizado. Se llena una vez y no se vuelve a
escribir, salvo la traducción cacheada.

**Columna nueva en `terms`: la pista.** Guarda el significado en inglés de la
acepción elegida. El índice único pasa de `(term_normalized)` a
`(term_normalized, pista)`.

Esto es lo único que toca código existente, y toca la pieza sobre la que se apoya
toda la deduplicación, así que el criterio es explícito:

- Las filas actuales y todo lo que salga de un PDF llevan **la pista vacía**.
- `saveExtraction` busca por `(term_normalized, '')`, así que **reextraer un PDF se
  comporta exactamente igual que hoy**: fusiona, no duplica, y no pierde el
  progreso ni una traducción corregida a mano.
- La migración añade la columna con valor por defecto vacío. **No se regenera
  ninguna tabla ni se vacía nada:** hay 44 términos reales con su estado de repaso.

**La pista en el repaso.** Se muestra pequeña bajo la palabra, en la cara delantera
de la tarjeta, solo cuando no está vacía, **recortada a una línea**: las glosas de
Wikcionario llegan a ocupar cuatro (la de *dictionary* las ocupa) y una pista que
tapa la palabra no es una pista. Se guarda entera; se recorta al mostrarla. Está en inglés a propósito: distingue
*bank* → orilla de *bank* → banco sin adelantar la respuesta en español.

**La fuente "Diccionario".** Las palabras añadidas a mano cuelgan de una fila de
`sources` con ese título, 0 páginas y coste 0 €, creada la primera vez que hace
falta. Así la biblioteca puede filtrar entre lo buscado a mano y lo extraído de un
PDF. Cada palabra añadida crea su aparición con el ejemplo del diccionario como
contexto, y su ficha en `card_states`, igual que una palabra extraída.

## 8. El traductor

Se llama **solo** cuando la entrada no trae traducción al español, y **solo con el
término suelto**. Comprobado el 2026-09-07:

- Traducir el término suelto funciona bien: *put up with* → aguantar, *bite off
  more than one can chew* → "quien mucho abarca, poco aprieta".
- **Traducir el término pegado a su definición se rompe**: *"come across: to give an
  impression"* devuelve *"venir a través: para dar una impresión"*. No se hace.
- Traducir la definición sola da español torpe (*"No tener ganas ni ganas de hacer
  algo"*). Por eso el significado se queda en inglés.

**Servicio:** MyMemory. Es el único gratuito que seguía en pie el 2026-09-07;
LibreTranslate público y las tres instancias de Lingva probadas estaban caídas.
Cuota: 5.000 caracteres al día de forma anónima, 50.000 mandando un correo en cada
petición. Un término son unos 10 caracteres. **Se empieza sin correo**: mandar el
correo de la usuaria a un tercero en cada consulta es una decisión suya, no una
opción por defecto.

**La caché es lo que hace esto robusto, pero solo cachea lo que puede.**
*(enmienda, 2026-09-08.)* El diseño original decía que un término se traduce una vez
en la vida y su traducción se guarda para siempre. Al construirlo se vio que eso
guardaba una mentira: **el traductor traduce el término, no la acepción**, así que
escribir su respuesta en cada fila la etiqueta como algo que no es. Buscar `bank`
—el ejemplo de esta misma especificación— dejaba sus siete etimologías con "banco",
la de *orilla* incluida, y al quedar cacheado no se reintentaba nunca: la única
corrección posible era el botón de pago.

La regla, tal como quedó:

- Se llama al traductor **una sola vez por término**, y su respuesta se **muestra**
  en todas las acepciones que no traigan español. Eso no cambia.
- Se **guarda** en la base solo cuando hay **exactamente una acepción sin español**,
  que es el único caso en que el dato es de verdad de esa acepción.
- Con varias, se muestra sin guardar. Volver a preguntar a MyMemory es gratis: la
  cuota anónima da unas 500 consultas al día para una sola usuaria.

Si el servicio se cae, lo ya guardado sigue funcionando y lo nuevo sale sin
traducción, con un aviso claro, el campo para escribirla a mano y el botón de afinar
con Claude. La llamada lleva un tiempo de espera de 5 segundos: un servicio colgado
no puede tumbar una búsqueda que ya tiene listos el significado y el ejemplo.

**El botón de afinar** manda el término y su significado en inglés a Claude y
devuelve una traducción curada. Es el único punto que cuesta dinero, se pulsa a
voluntad y el resultado se cachea igual.

## 9. Pruebas

Con Vitest, sobre lo que puede fallar en silencio:

- **Que reextraer siga fusionando** tras el cambio de índice único. Es la prueba que
  protege los 44 términos y su progreso: mismo PDF dos veces, un solo término, un
  solo estado de repaso, la traducción editada a mano intacta.
- **Que se puedan guardar dos acepciones** del mismo término con pistas distintas, y
  que el índice siga rechazando dos con la misma pista.
- **Las variantes del lema**: buscar *bite off more than you can chew* devuelve la
  ficha guardada como *one*.
- **El filtro de basura**: una glosa *"Used other than figuratively…"* no llega a
  la pantalla.
- **La caché del traductor**: dos búsquedas del mismo término, una sola llamada. Y
  que con varias acepciones sin español no se guarde nada *(enmienda, §8)*. Las
  pruebas no tocan la red; el traductor se inyecta.

**Prueba manual antes de dar esto por terminado:** la usuaria busca cinco palabras
suyas, las añade con su nivel, y aparecen en el repaso del día siguiente.

## 10. Orden de construcción

1. Arreglar el filtro (la basura) y cargar la tabla del diccionario.
2. La búsqueda con variantes del lema, con pruebas.
3. La migración de `terms` y la pista, con la prueba de que reextraer sigue igual.
4. La pantalla, sin traductor: significado, ejemplo y añadir.
5. El traductor con su caché.
6. La pista en la tarjeta de repaso.
7. El botón de afinar con Claude.

Del 1 al 4 la pantalla ya sirve. Del 5 en adelante es mejora.

## 11. Fuera de alcance

- Historial de búsquedas y favoritos
- Audio, pronunciación y conjugaciones
- Búsqueda de español a inglés
- Sugerencias mientras se escribe
- Corrección de erratas ("quisiste decir…")
- Editar el diccionario: es material de consulta, no datos de la usuaria

## 12. Lo que quedó sin construir

*(Añadido el 2026-09-08, al fundir la implementación.)* Esto no es "fuera de
alcance": es alcance de esta especificación que no llegó al código. Se anota aquí
para que nadie lo dé por hecho leyendo las secciones de arriba.

**La §5 pide que las acepciones se muestren "agrupadas por categoría gramatical".**
La pantalla las enseña en una lista plana, ordenada por identificador, con la
categoría escrita en cada ficha. Con siete fichas de `bank` de golpe, agruparlas se
notaría. Pendiente.

**Nada se ha probado en pantalla.** La implementación se hizo en un espacio aislado
sin base de datos, así que ninguna búsqueda real ha ocurrido nunca. Sigue pendiente
la prueba manual que la §9 pone como condición para dar esto por terminado.

**Dos pasos manuales**, que no forman parte del despliegue automático:

```bash
DATABASE_URL='...' npx drizzle-kit push
DATABASE_URL='...' npm run cargar:diccionario -- ~/Vocably-diccionario/dicc_todo.jsonl.gz
```

**Una carrera conocida y aceptada.** La fuente "Diccionario" se crea con un
`SELECT` seguido de un `INSERT`, y `sources.title` no tiene restricción de unicidad
—no puede tenerla: dos extracciones del mismo libro son a propósito dos fuentes
distintas—. Dos peticiones simultáneas podrían crear dos filas "Diccionario". Se
deja así a propósito: la §7 decide resolver la procedencia sin tocar el esquema, es
una aplicación de una sola usuaria, y la consecuencia es cosmética; no se pierde
ningún término ni ninguna ficha de repaso.
