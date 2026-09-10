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
      trozos.push(await textoDeUnaPagina(await documento.getPage(pagina)));
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "";
      throw new Error(
        `No se pudo leer la página ${pagina} del PDF.${detalle ? ` (${detalle})` : ""}`,
      );
    }
  }

  return trozos.join("\n");
}

/** Un trozo de texto tal como lo entrega el lector: sus fragmentos y poco más. */
type TrozoDeTexto = { items: { str?: string }[] };

/**
 * El texto de una página, leyendo el flujo **a mano** con su lector.
 *
 * La función cómoda del lector, `getTextContent()`, hace lo mismo pero
 * recorriendo el flujo con `for await (… of …)`. Iterar así un `ReadableStream`
 * es una API que Safari tardó años en traer, mucho después que el resto: en el
 * iPhone del usuario reventaba con «undefined is not a function», y como el
 * fallo saltaba al analizar la página, la pantalla acusaba de estar dañado a un
 * PDF perfectamente sano. `getReader()` funciona en todas partes desde siempre.
 *
 * **No vuelvas a `getTextContent()`.** Lee tres líneas menos y deja fuera a
 * quien no tenga el móvil al día, que es justo donde se usa esto.
 *
 * Los fragmentos sin `str` (marcas de estructura del PDF, no texto) cuentan
 * como cadena vacía en vez de saltarse: así siguen separando lo que tenían a
 * los lados, que es lo que hacía la función cómoda.
 */
async function textoDeUnaPagina(pagina: {
  streamTextContent: () => ReadableStream;
}): Promise<string> {
  const lector = pagina.streamTextContent().getReader();
  const partes: string[] = [];
  for (;;) {
    const { done, value } = (await lector.read()) as {
      done: boolean;
      value?: TrozoDeTexto;
    };
    if (done) break;
    for (const item of value?.items ?? []) partes.push(item.str ?? "");
  }
  return partes.join(" ");
}
