# Vocably — El español del diccionario

**Fecha:** 2026-09-09
**Estado:** especificado, sin implementar
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**Diccionario (lo que esto modifica):** `docs/superpowers/specs/2026-09-07-diccionario-design.md`

## 1. Qué es

El diccionario de la aplicación está en inglés. De sus **267.014 acepciones,
1.372 traen español** — un 0,5 %. El español que hoy se ve en `/diccionario` no
sale de la base: se pide a MyMemory en el momento de buscar.

Esto añade un **origen de español propio y gratuito** —el volcado del
Wikcionario español— y arregla los dos fallos que hacen que el que ya hay
funcione mal.

Es el primer paso de un trabajo mayor: **extraer vocabulario de un PDF sin
llamar a la IA**, que necesita poder resolver muchas palabras a español de golpe
y hoy no puede. Ese segundo paso tiene su propia especificación y no se diseña
aquí (§10).

## 2. Lo que se midió antes de decidir

Todo lo de abajo está comprobado, no estimado.

| Medida | Valor |
|---|---|
| Acepciones del diccionario inglés con español | 1.372 de 267.014 (**0,5 %**) |
| Filas con `translation_source` puesto | **0** — el caché no ha guardado nunca |
| Tamaño de `dictionary_entries` en la base | 55 MB (base entera: 63 MB de 0,5 GB) |
| Palabras inglesas en el Wikcionario español | **21.044**, 32.582 acepciones, 1,7 MB |
| Entradas de más de una palabra en ese volcado | **764** |

Cobertura del volcado español contra `en_50k.txt`:

| Tramo de frecuencia | Cubierto |
|---|---|
| 1 – 1.000 | **93 %** |
| 1.000 – 5.000 | **76 %** |
| 5.000 – 20.000 | **31 %** |
| 20.000 – 50.000 | **9 %** |

De doce verbos frasales corrientes probados, el volcado español tiene tres
(`give up`, `look after`, `make up`) y le faltan nueve, entre ellos `come
across`, `take off` y `turn down`. El diccionario inglés tiene 20.012 verbos
frasales.

**Conclusión, y es la que ordena el diseño:** el Wikcionario español es un buen
primer escalón para palabras sueltas comunes y **no sirve para verbos frasales**.
Los verbos frasales los seguirá resolviendo MyMemory, que es exactamente por lo
que arreglarlo no es opcional.

## 3. Decisiones tomadas

Las cinco que fijan el resto, todas del usuario:

1. **El español primero.** Se carga el volcado español antes de tocar la
   extracción sin IA, para que esa extracción nazca ya en español.
2. **El español manda, el inglés queda de apoyo.** La pantalla enseña
   significados en español; el inglés sigue guardado y sigue siendo lo que
   distingue `bank`→orilla de `bank`→banco en las tarjetas, pero no se lee salvo
   que se despliegue.
3. **MyMemory se queda, arreglado.** Es lo que tapa el hueco —y el único origen
   que cubre verbos frasales—, así que se le arreglan sus dos fallos en vez de
   quitarlo.
4. **No se casan las acepciones de los dos Wikcionarios.** Son obras
   independientes y no numeran igual: hacer corresponder «la 2ª de una» con «la
   2ª de la otra» sería inventarse un dato. El usuario ya lo aceptó al pedirlo:
   *«aunque no me dé el significado exacto»*.
5. **Cinco significados.** Es lo que se enseña por palabra y categoría.

## 4. Los dos fallos que se arreglan

Los dos están en el camino de esta obra, y sin ellos el escalón de MyMemory no
se sostiene.

### 4.1 El caché no guarda casi nunca

`db/repository/diccionario.ts:129` guarda la traducción **solo si a la palabra le
faltaba el español en una única acepción**:

```ts
if (sinEspanol.length === 1) {
  await db.update(dictionaryEntries).set({ translations, translationSource: "mymemory" })...
}
```

Como casi toda palabra tiene varias acepciones, la condición casi nunca se
cumple: por eso las 267.014 filas tienen la fuente a nulo. Cada búsqueda de la
misma palabra vuelve a gastar cuota.

**No es un error de descuido, y por eso no se arregla moviendo la condición.**
MyMemory traduce *la palabra*, no *la acepción*. Escribir esa traducción encima
de cada acepción inglesa haría parecer que cada una tiene su español propio, que
es falso. Quien lo escribió prefirió no guardar antes que falsear.

**Se disuelve con la tabla nueva** (§5): el español se guarda una vez, a nivel de
palabra, que es el nivel al que MyMemory responde. `traducirSiFalta` desaparece
como tal —su trabajo pasa al escalón 4 de §6—, y `dictionary_entries` deja de
escribirse: conserva solo lo que trajo el volcado inglés, que se traslada una vez
a la tabla nueva (§8.1).

### 4.2 No se comprueba la cuota

`lib/diccionario/traductor.ts` lee `responseData.translatedText` y
`matches[].translation` sin mirar `responseStatus` ni `quotaFinished`. Agotada la
cuota diaria, MyMemory responde 200 con su aviso —`MYMEMORY WARNING: YOU USED
ALL AVAILABLE FREE TRANSLATIONS FOR TODAY`— dentro de `translatedText`, y ese
texto se pintaría **como si fuera la traducción al español**.

Se comprueba `responseStatus` y `quotaFinished`, y se descarta cualquier
candidata que traiga la marca del aviso. Cuota agotada devuelve lista vacía, que
es el mismo camino que un servicio caído y ya está tratado.

**El correo del usuario no se manda.** MyMemory dobla la cuota a 50.000
caracteres si se le manda un correo en cada petición; no se hace. Es una decisión
de privacidad ya tomada en el diseño del diccionario y no se reabre aquí.

## 5. Datos

Una tabla nueva. **No cuelga de `dictionary_entries`** por la decisión 4 de §3:
colgarla daría a entender una correspondencia entre acepciones que no existe.

```ts
export const spanishMeanings = pgTable(
  "spanish_meanings",
  {
    id: serial("id").primaryKey(),
    termNormalized: text("term_normalized").notNull(),
    term: text("term").notNull(),
    /** Categoría gramatical de Wikcionario. Cadena vacía si viene de MyMemory,
        que traduce la palabra sin decir de qué categoría habla. */
    pos: text("pos").notNull(),
    /** Los significados en español, en el orden del original. */
    meanings: text("meanings").array().notNull().default([]),
    /** `wikcionario-es` | `wikcionario-en` | `mymemory`. */
    source: text("source").notNull(),
  },
  (table) => ({
    terminoPosIdx: uniqueIndex("spanish_meanings_term_pos_idx").on(
      table.termNormalized,
      table.pos,
    ),
  }),
);
```

**Por qué una fila por palabra y categoría, y no por acepción.** Es la forma del
dato de verdad: el Wikcionario español da una lista ordenada de significados para
`dog` como verbo, no acepciones numeradas que casen con nada. Guardarla como
lista impide que nadie la una por error con las acepciones inglesas.

**El índice único es (término, categoría)**, no solo el término: `dog`
sustantivo y `dog` verbo son filas distintas, y las de MyMemory ocupan la
categoría vacía. Ese único también es lo que hace que cargar dos veces no
duplique.

**Tamaño:** unas 21.000 filas, del orden de 2 MB. La base va por 63 MB de los
512 MB gratis de Neon.

**Se guardan hasta ocho significados y se enseñan cinco.** El fichero filtrado ya
trae hasta ocho; recortar a cinco al cargar ahorraría kilobytes y costaría una
descarga de 95 MB el día que se quieran seis.

## 6. La consulta

La cadena de `/api/diccionario`, con el escalón nuevo en negrita:

1. La biblioteca del usuario (`terms`) — lo que ya tiene guardado.
2. El diccionario inglés (`dictionary_entries`) — significado, ejemplo, categoría.
3. **`spanish_meanings`** — los significados en español. Gratis e instantáneo.
4. **MyMemory**, solo si el 3 no trajo nada para esa palabra. Lo que devuelva se
   guarda en `spanish_meanings` con `source: "mymemory"` y no se vuelve a pedir
   nunca.
5. Si tampoco, no hay español y se dice. El botón de afinar con IA
   (`/api/diccionario/afinar`) sigue siendo la salida, aparte y de pago como
   hasta ahora.

El escalón 3 busca con `variantesDelLema`, igual que el 2, para que un idiom
escrito con *you* encuentre la ficha guardada con *one*.

**Una palabra puede tener filas de varios orígenes a la vez** —las de MyMemory
ocupan la categoría vacía y nunca chocan con las otras en el índice único—, así
que la consulta se queda con las mejores: si hay filas de Wikcionario para esa
palabra, **la de MyMemory no se enseña**. Se sigue guardando: si un día el
volcado deja de traer la palabra, vuelve a servir sin gastar cuota otra vez.

La respuesta de la ruta gana un campo `significados`, una lista de grupos
`{ pos, nombre, meanings, source }`, ya ordenada por `agruparPorCategoria`.

## 7. La pantalla

`components/BuscadorDiccionario.tsx`:

- Los **significados en español** arriba, agrupados por categoría con
  `agruparPorCategoria` y `nombreDeCategoria`, que ya existen. Hasta cinco por
  grupo.
- El grupo de MyMemory —categoría vacía— sale sin encabezado de categoría, porque
  no se sabe de cuál habla.
- Debajo de cada grupo, en letra pequeña, **de dónde sale**: «Wikcionario
  español», «Wikcionario inglés» o «traducción automática». Los dos primeros los
  han escrito personas y el tercero es una máquina; enseñarlos igual sería mentir
  sobre lo que se lee.
- El **inglés queda plegado** y se abre a petición. Sigue siendo lo que se guarda
  como `senseHint` al añadir una acepción a la biblioteca, así que las tarjetas
  no cambian en nada.
- Sin español en ningún origen: se dice con esas palabras, y el botón de afinar
  con IA queda al lado.

## 8. La carga

### 8.1 El traslado de lo que ya hay

Antes de nada, **las 1.372 acepciones inglesas que sí traen español pasan a la
tabla nueva**, con `source: "wikcionario-en"` y la categoría de su acepción. Sin
este paso quedarían invisibles: la consulta de §6 solo mira `spanish_meanings`, y
ese español está pagado y es de fuente humana.

Como el volcado inglés guarda una fila por acepción y la tabla nueva una por
palabra y categoría, las traducciones de varias acepciones de la misma palabra y
categoría se juntan en una sola lista, sin repetidos y en el orden en que
estaban.

### 8.2 El volcado español

`scripts/cargar-espanol.ts`, hermano del cargador del diccionario inglés y con la
misma forma: lee `dicc_es.jsonl.gz` línea a línea con **`lineasDeFicheroGz`** —el
generador perezoso que arregló el cuelgue de la carga anterior— y escribe por
lotes dentro de una transacción.

Es idempotente por el índice único de §5: volver a cargarlo actualiza en vez de
duplicar. **Donde choque con una fila `wikcionario-en`, gana el español**: una es
un diccionario escrito en español y la otra una tabla de traducciones. Con las de
MyMemory no choca nunca, porque aquellas ocupan la categoría vacía y estas una
categoría de verdad; de esa convivencia se ocupa la consulta, no la carga (§6).

El fichero se produce con `filtrar_es.py`, ya escrito y ejecutado, que filtra el
volcado de kaikki.org **mientras se descarga**: los 95 MB comprimidos no se
guardan, igual que se hizo con el inglés.

## 9. Pruebas

Lógica pura, fuera de la base, como el resto del proyecto (Vitest, `environment:
node`, sin jsdom):

- **Leer una línea del volcado español** → filas. Línea ilegible, entrada sin
  significados, entrada sin categoría: se salta, no revienta la carga.
- **Recorte a ocho** al guardar y **a cinco** al enseñar.
- **`esRespuestaUtilDeMyMemory`**: respuesta buena, `responseStatus` distinto de
  200, `quotaFinished: true`, y el texto del aviso colado en `translatedText`.
  Este último es el que importa: es el fallo que pinta el aviso como si fuera
  español.

Con PGlite, contra una base de verdad:

- La cadena de §6 en sus cuatro desenlaces: lo resuelve el volcado español; lo
  resuelve MyMemory; **lo que resuelve MyMemory queda guardado y a la segunda
  búsqueda ya no se le llama**; no lo resuelve nadie y la respuesta lo dice.
- Una palabra con filas de Wikcionario **y** de MyMemory enseña solo las
  primeras, y la de MyMemory sigue en la base.
- El traslado de §8.1 junta en una lista, sin repetidos, las traducciones de
  varias acepciones de la misma palabra y categoría.
- Cargar dos veces el mismo fichero deja el mismo número de filas.
- Una segunda carga pisa una fila `wikcionario-en` con la española, y no borra
  ninguna de MyMemory.

## 10. Fuera de alcance

- **Extraer sin IA.** Es el proyecto siguiente y tendrá su propia
  especificación. Necesita además leer el texto de un PDF, que hoy no sabe hacer
  nadie: `pdf-lib` recorta páginas, no lee letras, y quien lee el PDF es Claude.
- **Nivel por palabra.** `terms.level` es hoy el nivel que se elige para el PDF
  entero, igual para todas sus palabras. Sacarlo de `en_50k.txt` es posible y no
  se hace aquí.
- **Verbos frasales en español más allá de MyMemory.** El volcado español no los
  tiene (§2) y buscar otra fuente libre queda descartado por ahora.
- **Las tarjetas.** No se tocan: ni su cara, ni `senseHint`, ni el repaso.

## 11. Orden de construcción

1. La tabla `spanish_meanings` y su migración.
2. El traslado de lo que ya hay (§8.1). Va antes que el volcado nuevo para que la
   tabla nunca esté vacía y para que el orden de precedencia de §8.2 se ejercite
   de verdad.
3. El módulo puro que lee el volcado, y el cargador.
4. La consulta del escalón 3 y la cadena de §6.
5. Los dos arreglos de MyMemory (§4), que dependen de que la tabla ya exista.
6. La pantalla.

La migración se aplica a la base real **a mano, ejecutando el `.sql`**, no con
`drizzle-kit push`: push no ejecuta el fichero, compara `db/schema.ts` con la
base y pregunta, y contestar mal a esa pregunta ya costó un susto en la
migración 0005.
