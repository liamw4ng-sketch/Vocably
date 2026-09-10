/**
 * Saca el texto de un rango de páginas de un PDF, **en el navegador**.
 *
 * El PDF no sale del dispositivo: al servidor solo viajan después las cadenas
 * candidatas, que para cinco páginas son unos 40 KB. Es también lo que libra a
 * esta extracción del límite de 4,5 MB por petición que obligó a trocear la
 * extracción con IA.
 *
 * **El lector se importa aquí dentro y no arriba del fichero**, a propósito: su
 * API pesa 129 KB comprimido y su motor de análisis otros 366 KB. Con la
 * importación diferida nada de eso entra en el paquete que se descarga al abrir
 * la aplicación desde el icono del móvil; se pide la primera vez que se lee un
 * PDF y ya se queda.
 *
 * Solo lee PDFs **con texto dentro**. Si el rango pedido no cabe en el PDF
 * (la página `desde` no existe de verdad), esta función lanza un error
 * diciendo cuántas páginas tiene el documento; así una cadena vacía en el
 * resultado ya no puede deberse a eso. Lo que sí puede seguir dando cadena
 * vacía, y son indistinguibles entre sí desde aquí, son dos causas legítimas:
 * un escaneo (que es una imagen, sin capa de texto) o páginas que están
 * genuinamente en blanco. Quien llame tiene que decírselo al usuario en esos
 * términos generales, no como «parece un escaneo».
 */
export async function textoDePaginas(
  bytes: Uint8Array,
  desde: number,
  hasta: number,
): Promise<string> {
  if (
    !Number.isInteger(desde) ||
    !Number.isInteger(hasta) ||
    desde < 1 ||
    hasta < desde
  ) {
    throw new Error("El rango de páginas no es válido.");
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  let documento;
  try {
    documento = await pdfjs.getDocument({ data: bytes }).promise;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "";
    throw new Error(
      `No se pudo leer el PDF: puede estar cifrado o dañado.${detalle ? ` (${detalle})` : ""}`,
    );
  }

  if (desde > documento.numPages) {
    throw new Error(
      `El PDF tiene ${documento.numPages} páginas y has pedido desde la ${desde}.`,
    );
  }

  const trozos: string[] = [];
  const ultima = Math.min(hasta, documento.numPages);
  for (let pagina = desde; pagina <= ultima; pagina += 1) {
    // Un try/catch por página, no uno solo alrededor de todo el bucle: así el
    // mensaje puede decir en qué página concreta falló sin necesitar una
    // variable aparte para recordarla. Y es un catch distinto del de abrir el
    // documento a propósito: un fallo aquí es de esta página en particular
    // (p. ej. un flujo de contenido dañado), no de que el PDF entero esté
    // cifrado o corrupto, así que merece su propio mensaje en vez de
    // compartir uno que hablaría de "el PDF" en general.
    try {
      const contenido = await (await documento.getPage(pagina)).getTextContent();
      trozos.push(
        contenido.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "";
      throw new Error(
        `No se pudo leer la página ${pagina} del PDF.${detalle ? ` (${detalle})` : ""}`,
      );
    }
  }

  return trozos.join("\n");
}
