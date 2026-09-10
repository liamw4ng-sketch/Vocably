import { describe, it, expect, vi } from "vitest";

/**
 * Estas dos pruebas necesitan que `pdfjs.getDocument(...).promise` resuelva
 * con éxito (un documento con `numPages` conocido), y ni un PDF inválido ni
 * uno real y válido sirven para eso aquí: el inválido nunca llega a abrirse,
 * y el válido tampoco, porque en Vitest sobre Node (sin bundler) la
 * resolución de `workerSrc` falla incluso para un PDF perfectamente bueno
 * (ver el comentario en tests/extraer/pdf-texto.test.ts). Sin fixtures
 * binarios en el proyecto, la única forma de fijar `numPages` y el
 * comportamiento de `getPage` es sustituir `pdfjs-dist` entero por un doble
 * mínimo. `vi.mock` se aplica a todo este fichero, así que las pruebas que
 * sí usan el lector real viven aparte, en pdf-texto.test.ts.
 */
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: (pagina: number) => {
        if (pagina === 2) {
          return Promise.reject(new Error("corrupt content stream"));
        }
        return Promise.resolve({
          // Un flujo que se acaba enseguida: a estas dos pruebas no les importa
          // el texto, solo que la página se lea sin reventar.
          streamTextContent: () => ({
            getReader: () => ({
              read: () => Promise.resolve({ done: true, value: undefined }),
            }),
          }),
        });
      },
    }),
  }),
}));

import { textoDePaginas } from "@/lib/extraer/pdf-texto";

const bytes = new Uint8Array([1, 2, 3]);

describe("textoDePaginas con un lector simulado (documento que sí se abre)", () => {
  /**
   * Si `desde` se sale del PDF de verdad (p. ej. pedir la página 200 de un
   * PDF de 100), el resultado no puede ser una cadena vacía indistinguible
   * de un escaneo: tiene que decir cuántas páginas tiene el PDF, con la
   * misma redacción que ya usa lib/pdf-slice.ts para el caso simétrico
   * (`hasta` fuera de rango).
   */
  it("dice cuántas páginas tiene de verdad cuando 'desde' se sale del PDF", async () => {
    await expect(textoDePaginas(bytes, 5, 6)).rejects.toThrow(
      /El PDF tiene 3 páginas y has pedido desde la 5\./,
    );
  });

  /**
   * Un PDF puede abrirse bien y aun así fallar al analizar una página en
   * concreto (p. ej. un flujo de contenido dañado). Ese fallo tiene que dar
   * un mensaje en español que además diga en qué página ocurrió, no la
   * excepción cruda del lector.
   */
  it("un fallo al analizar una página da un mensaje en español con el número de página", async () => {
    await expect(textoDePaginas(bytes, 1, 3)).rejects.toThrow(/página 2/i);
  });
});
