/**
 * La entrada al abrir la aplicación: primero el nombre, después una frase, y
 * la capa entera se va. Poco más de tres segundos en total, y los tiempos los
 * manda la frase: tiene que dar tiempo a leerla entera de una pasada. Los
 * números exactos están en `app/globals.css`, junto a los fotogramas.
 *
 * **No lleva JavaScript, y eso es el diseño, no una economía.** En el App
 * Router el layout no se vuelve a montar al navegar entre pantallas, así que
 * este elemento sobrevive a los cambios de ruta y su animación CSS solo
 * arranca cuando la página se carga entera: abrir desde el icono del iPhone,
 * o recargar. Moverse entre Repaso, Biblioteca y Diccionario no la repite.
 *
 * Por eso la frase es una y siempre la misma: elegirla al azar en cada
 * apertura obligaría a decidirlo en el cliente, y las cuatro pantallas se
 * generan estáticas, así que el servidor la dejaría fijada hasta el siguiente
 * despliegue de todas formas.
 *
 * **No bloquea nada**: `pointer-events-none` desde el primer fotograma, así que
 * un toque mientras se desvanece llega al contenido de debajo.
 *
 * El `opacity: 0` en línea es el estado en reposo: la capa solo se ve mientras
 * corre la animación, que manda sobre el estilo en línea mientras dura. Si la
 * hoja de estilos aún no ha llegado, o el sistema pide movimiento reducido, no
 * se ve nada en vez de quedarse un panel opaco encima de la aplicación.
 *
 * Los dos textos comparten la misma celda de la rejilla a propósito: si fueran
 * uno detrás de otro en el flujo, al desaparecer el nombre la frase daría un
 * salto hacia arriba justo mientras aparece.
 */
export function EntradaApp() {
  return (
    <div
      aria-hidden
      style={{ opacity: 0 }}
      className="animacion-entrada pointer-events-none fixed inset-0 z-50 grid place-items-center bg-fondo p-8"
    >
      <p
        style={{ gridArea: "1 / 1", fontSize: "var(--tamano-6)" }}
        className="entrada-nombre font-serif font-semibold text-texto"
      >
        Vocably
      </p>
      {/* En inglés a propósito: es el idioma que la aplicación sirve para
          aprender, así que abrirla ya es una dosis diminuta de él. Y describe
          lo que hace el repaso espaciado —volver a encontrarte una palabra—,
          en vez de ser un lema motivacional pegado encima. */}
      <p
        lang="en"
        style={{ gridArea: "1 / 1", fontSize: "var(--tamano-3)" }}
        className="entrada-frase max-w-sm text-balance text-center font-serif italic text-texto-suave"
      >
        Words you meet again become words you own.
      </p>
    </div>
  );
}
