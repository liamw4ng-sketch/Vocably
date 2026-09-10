import { describe, it, expect, vi } from "vitest";

/**
 * Esta prueba fija **cómo** se lee el texto de una página, no solo qué sale.
 *
 * El lector de PDF entrega el texto por un `ReadableStream`, y su función
 * cómoda `getTextContent()` lo recorre con `for await (… of …)`. Iterar así un
 * `ReadableStream` es una API que Safari no trajo hasta muy tarde: en el iPhone
 * del usuario reventaba con «undefined is not a function», y como el fallo
 * ocurría al analizar la página, la pantalla decía «No se pudo leer la página 1
 * del PDF» de un PDF perfectamente sano.
 *
 * Por eso el doble de aquí entrega **solo** `streamTextContent()`, y su flujo
 * **solo** tiene `getReader()`: ni `getTextContent` ni `Symbol.asyncIterator`.
 * Si alguien vuelve a la función cómoda, esta prueba se pone roja.
 */
function flujoDeTrozos(trozos: { items: { str?: string }[] }[]) {
  let siguiente = 0;
  // A propósito un objeto pelado y no un ReadableStream de verdad: en Node el
  // de verdad sí sabe iterarse, así que no demostraría nada.
  return {
    getReader: () => ({
      read: () =>
        Promise.resolve(
          siguiente < trozos.length
            ? { done: false, value: trozos[siguiente++] }
            : { done: true, value: undefined },
        ),
    }),
  };
}

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: (pagina: number) =>
        Promise.resolve({
          streamTextContent: () =>
            pagina === 1
              ? flujoDeTrozos([
                  { items: [{ str: "The" }, { str: "bank" }] },
                  { items: [{ str: "of" }, {}, { str: "the river" }] },
                ])
              : flujoDeTrozos([{ items: [{ str: "Segunda" }] }]),
        }),
    }),
  }),
}));

import { textoDePaginas } from "@/lib/extraer/pdf-texto";

const bytes = new Uint8Array([1, 2, 3]);

describe("textoDePaginas leyendo el flujo a mano", () => {
  it("junta los trozos de una página sin iterar el flujo", async () => {
    expect(await textoDePaginas(bytes, 1, 1)).toBe("The bank of  the river");
  });

  it("separa las páginas con un salto de línea", async () => {
    expect(await textoDePaginas(bytes, 1, 2)).toBe(
      "The bank of  the river\nSegunda",
    );
  });
});
