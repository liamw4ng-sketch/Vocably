# Vocably — El diccionario: una lista de traducciones y tú eliges

**Fecha:** 2026-09-10
**Estado:** especificado, sin implementar
**Sale de:** la rama `extraer-sin-ia`, porque se apoya en `lib/diccionario/traduccion.ts`, que nació allí
**Diseño general:** `docs/superpowers/specs/2026-09-06-app-vocabulario-design.md`
**El diccionario actual (lo que esto rehace):** `docs/superpowers/specs/2026-09-07-diccionario-design.md`
**El español del diccionario:** `docs/superpowers/specs/2026-09-09-espanol-del-diccionario-design.md`

## 1. Qué es

La pantalla del diccionario enseña hoy **una ficha por acepción**: siete tarjetas casi
idénticas para `bank`, cada una con su significado inglés plegado, su traducción y sus
propios controles para guardar.

El usuario pidió otra cosa, y la pidió dibujada:

```
[palabra]

* Todas las traducciones posibles en español
* Significado 1 en inglés
* Significado 2 en inglés
* Significado X
* …
```

Una sola pantalla por palabra: **las traducciones todas juntas en una lista**, los
**significados en inglés numerados y a la vista** con su ejemplo, y al guardar se elige
significado, traducción y nivel.

## 2. Lo que esto resuelve, y que veníamos arrastrando

El 2026-09-09 se decidió plegar el inglés porque el usuario dijo *«no necesito la
explicación en inglés»*. La revisión final de aquella rama encontró la consecuencia:
**las siete acepciones de `bank` quedaban siete fichas indistinguibles**, y había que
desplegar una por una para saber cuál era la orilla y cuál el banco.

Se le devolvió la decisión con el dato medido, y su respuesta fue esta estructura. **No
es un cambio de opinión: es la misma preferencia con la consecuencia delante.** No quiere
*leer* inglés como explicación; quiere *verlo* como etiqueta para distinguir sentidos.

Y hay una razón de fondo que él mismo dio: *«yo mismo sabré cuál es el correcto»*. Es
profesor de idiomas. Emparejar sentido y traducción lo hace mejor que cualquier
heurística, y la aplicación deja de tener que adivinarlo.

## 3. Decisiones tomadas

Las cuatro del usuario:

1. **Una sola lista de traducciones**, revueltas, de todos los orígenes. Se le preguntó
   expresamente si prefería las de una acepción junto a su acepción, y dijo que no.
2. **Los significados en inglés, numerados y a la vista**, con su ejemplo si lo hay.
3. **Al guardar elige tres cosas**: qué significado, qué traducción y qué nivel.
4. **El nivel se elige como ahora.** No cambia.

## 4. La pantalla

Una sola tarjeta por palabra buscada.

```
bank                                                    sustantivo · verbo

Traducciones al español
  ( ) banco      ( ) orilla     ( ) ribera     ( ) hilera
  ( ) Banco.     ( ) Reserva.
  ( ) escribir otra: [____________________]

Significados
  (•) 1. A financial institution.
         "She deposited the money at the bank."
  ( ) 2. An edge of a river or lake.
         "They sat on the bank watching the water."
  ( ) 3. A row or tier of objects.
      4. To deposit money at a bank.          ← ya en tu repaso

Nivel  [B2 ▾]                                              [ Añadir ]

[ Afinar con IA ]   ← sobre el significado elegido; cuesta unos céntimos
```

**Lo que cambia respecto a hoy:**

- Desaparecen las fichas por acepción y sus controles repetidos. Un solo bloque, un solo
  botón.
- **El inglés vuelve a estar a la vista**, numerado. Es lo que distingue un sentido de
  otro, y es el único dato que lo hace.
- Las traducciones se **eligen de una lista**, no se calculan.

**Lo que no cambia:**

- El bloque de **«Ya en tu repaso»** sigue arriba, como está.
- El **nivel** se elige con el mismo control.
- **«Afinar con IA»** sigue siendo el único punto de pago, y sigue avisando de que cuesta
  antes de pulsarlo (§6).
- El aviso de que una palabra no está en el diccionario, y el de que está solo en la
  biblioteca.

## 5. La lista de traducciones

Es la unión, sin repetidos, de los dos orígenes que ya existen:

| Origen | Qué es | Ejemplo |
|---|---|---|
| `dictionary_entries.translations` | equivalentes cortos de **una acepción**; los pone el volcado inglés o *afinar con IA* | `orilla`, `banco` |
| `spanish_meanings.meanings` | definiciones de **la palabra**, del Wikcionario español o de MyMemory | `Banco.`, `Reserva.` |

**Los cortos van primero.** Son equivalentes de una palabra y hacen mejor reverso de
tarjeta; los del Wikcionario español son definiciones enteras, con su punto final. El
orden lo dice: lo más parecido a una traducción, arriba.

Dentro de cada grupo se conserva el orden en que llegan: las acepciones vienen ordenadas
por su `id`, que es el orden de sentidos de Wikcionario, y los significados de la palabra
por categoría gramatical. **El orden no depende de qué significado esté elegido**: la
lista no se reordena al cambiar de sentido, porque una lista que se mueve bajo el dedo es
imposible de usar en un móvil.

**Se comparan sin distinguir mayúsculas ni espacios de sobra** para no ofrecer `Banco.` y
`banco` como si fueran dos opciones distintas; se enseña la primera forma que apareció.

**Y hay una opción más, siempre: escribir otra.** Es la que permite corregir una
traducción automática mala, y es exactamente lo que el usuario pidió al decir que él sabe
cuál es la correcta. Escribir algo la selecciona.

**Si no hay ninguna traducción de ningún origen**, se dice con esas palabras y solo queda
la de escribirla a mano — que es la que ya resuelve el caso, sin gastar cuota ni dinero.

## 6. Qué se guarda

Al pulsar **Añadir**, la tarjeta que entra en el repaso lleva:

| Campo | De dónde sale |
|---|---|
| `term` | la palabra buscada, tal como la trae el diccionario |
| `pos` | la categoría **de la acepción elegida** |
| `senseHint` | el **significado inglés elegido** |
| `translation` | la **traducción elegida** |
| `example` | el ejemplo de esa acepción, si lo hay |
| `level` | el que se elija |

`senseHint` sigue siendo lo que distingue dos acepciones de la misma palabra en la
biblioteca — `bank`→orilla de `bank`→banco—, así que la clave de deduplicación no cambia.

**No hace falta tocar `anadirDesdeDiccionario`**: recibe exactamente esos campos.

**El botón no se puede pulsar** sin las tres elecciones hechas: significado, traducción y
nivel. Es la misma garantía que hoy da `botonAnadirDeshabilitado`, con una condición más.

**«Afinar con IA»** actúa sobre **el significado elegido** —es lo que pide a Claude una
traducción curada de esa acepción concreta— y lo que devuelva **se añade a la lista de
traducciones**, arriba, ya seleccionado. Si no hay ningún significado elegido, el botón
no se puede pulsar: sin acepción no hay nada que afinar.

## 7. Los significados ya guardados

Un significado que ya está en la biblioteca **se enseña igual, numerado, pero no se puede
elegir**, y lo dice: «ya en tu repaso». Esconderlo cambiaría la numeración entre visitas y
haría imposible referirse a «el tercero».

Hoy esa marca existe por acepción (`yaGuardada`); se conserva tal cual.

## 8. La ruta

`GET /api/diccionario` **no cambia de forma**. Ya devuelve las cuatro piezas que la
pantalla nueva necesita: `enBiblioteca`, `acepciones` (con `gloss`, `example`,
`translations`, `pos`, `yaGuardada`) y `significados`.

**La lista unificada se arma en el cliente**, no en el servidor: es una unión de dos
campos que ya viajan, y hacerla en el servidor obligaría a devolver dos veces lo mismo.
La función que la arma es pura y exportada, así que se prueba sin jsdom.

## 9. Pruebas

Lógica pura, fuera de la base, como el resto del proyecto (Vitest, `environment: "node"`,
sin jsdom):

- **La unión de traducciones**: los cortos delante; sin repetidos ignorando mayúsculas y
  espacios; se conserva la primera forma vista; lista vacía cuando no hay ninguna.
- **Qué se guarda**: que el `senseHint` es el del significado elegido y no el de otro, y
  que la traducción elegida gana sobre todo lo demás.
- **El botón**: deshabilitado sin significado, sin traducción, sin nivel, y con la
  petición en vuelo.
- **Afinar**: deshabilitado sin significado elegido; lo que devuelve entra en la lista y
  queda seleccionado.
- **Los ya guardados**: no se pueden elegir y siguen numerados en su sitio.

No hay pruebas de la base: esta rama no cambia ninguna consulta.

## 10. Fuera de alcance

- **La pantalla de extraer sin IA.** Tiene su propio diseño, con una lista de cuarenta
  candidatas donde no cabe elegir sentido por sentido. No se toca.
- **El origen de cada traducción** («Wikcionario español» / «traducción automática»). Hoy
  se enseña por grupo; al revolverlas en una lista se pierde. Se acepta: el usuario pidió
  la lista revuelta sabiendo que las mezclaba, y elige él.
- **La ruta y las tablas.** Nada de esto cambia el esquema ni las consultas.
- **Las tarjetas ya guardadas.** No se migran ni se tocan.

## 11. Orden de construcción

1. La función pura que une las traducciones, con sus pruebas.
2. Las funciones puras de la elección: qué se guarda, cuándo se puede guardar, cuándo se
   puede afinar.
3. La pantalla.

Nada de esto necesita migración ni carga: **no hay que tocar la base de datos.**
