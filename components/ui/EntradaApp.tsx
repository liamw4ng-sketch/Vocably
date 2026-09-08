/**
 * La entrada al abrir la aplicación: el nombre aparece un instante sobre el
 * fondo y se va.
 *
 * **No lleva JavaScript, y eso es el diseño, no una economía.** En el App
 * Router el layout no se vuelve a montar al navegar entre pantallas, así que
 * este elemento sobrevive a los cambios de ruta y su animación CSS solo
 * arranca cuando la página se carga entera: abrir desde el icono del iPhone,
 * o recargar. Moverse entre Repaso, Biblioteca y Diccionario no la repite.
 * Con `sessionStorage` y un efecto se conseguía lo mismo, pero pagando un
 * estado de cliente, una lectura que puede lanzar en navegación privada y un
 * render de más.
 *
 * **No bloquea nada**: `pointer-events-none` desde el primer fotograma, así que
 * un toque mientras se desvanece llega al contenido de debajo.
 *
 * El `opacity: 0` en línea es el estado en reposo: la capa solo se ve mientras
 * corre la animación, que manda sobre el estilo en línea mientras dura. Si la
 * hoja de estilos aún no ha llegado, o el sistema pide movimiento reducido, no
 * se ve nada en vez de quedarse un panel opaco encima de la aplicación.
 */
export function EntradaApp() {
  return (
    <div
      aria-hidden
      style={{ opacity: 0 }}
      className="animacion-entrada pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-fondo"
    >
      <p style={{ fontSize: "var(--tamano-6)" }} className="font-serif font-semibold text-texto">
        Vocably
      </p>
    </div>
  );
}
