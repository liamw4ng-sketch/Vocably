/**
 * La transición al cambiar de sección.
 *
 * Vive en una plantilla y no en el layout porque el App Router **vuelve a
 * montar la plantilla en cada navegación**, mientras que el layout persiste.
 * Esa diferencia es justo lo que separa las dos animaciones de la aplicación:
 * la entrada, que va en el layout, se ve una vez por apertura; esta, que va
 * aquí, se ve cada vez que se pasa de Repaso a Biblioteca o al Diccionario.
 *
 * Las clases de reparto son para no romper la columna flexible del `body`: sin
 * ellas este `div` se interpone entre el `body` y el `main`, y el `flex-1` del
 * repaso deja de estirar hasta abajo.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animacion-seccion flex flex-1 flex-col">{children}</div>;
}
