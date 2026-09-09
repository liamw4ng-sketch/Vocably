import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { valor: null as unknown };
vi.mock("@/db/client", () => ({ getDb: () => db.valor }));

const buscarEnDiccionario = vi.fn();
const buscarEnBiblioteca = vi.fn();
vi.mock("@/db/repository/diccionario", () => ({
  buscarEnDiccionario: (...args: unknown[]) => buscarEnDiccionario(...args),
  buscarEnBiblioteca: (...args: unknown[]) => buscarEnBiblioteca(...args),
}));

const buscarSignificadosEspanoles = vi.fn();
// Por defecto se comporta como el escalón que no hace falta: devuelve lo que ya
// se encontró. Cada prueba que quiera ejercitar el traductor lo redefine.
const completarConTraductor = vi.fn<
  (db: unknown, termino: string, encontrados: unknown, traductor: unknown) => Promise<unknown>
>(async (_db: unknown, _termino: string, encontrados: unknown) => encontrados);
vi.mock("@/db/repository/espanol", () => ({
  buscarSignificadosEspanoles: (...args: unknown[]) => buscarSignificadosEspanoles(...args),
  completarConTraductor: (db: unknown, termino: string, encontrados: unknown, traductor: unknown) =>
    completarConTraductor(db, termino, encontrados, traductor),
}));

const { GET } = await import("@/app/api/diccionario/route");

beforeEach(() => {
  buscarEnDiccionario.mockReset();
  buscarEnBiblioteca.mockReset();
  buscarSignificadosEspanoles.mockReset();
  buscarSignificadosEspanoles.mockResolvedValue([]);
});

const pide = (q: string) => GET(new Request(`http://localhost/api/diccionario?q=${encodeURIComponent(q)}`));

describe("GET /api/diccionario", () => {
  it("una búsqueda vacía responde 400 sin consultar nada", async () => {
    const res = await pide("   ");
    expect(res.status).toBe(400);
    expect(buscarEnDiccionario).not.toHaveBeenCalled();
  });

  it("marca la acepción que ya está en la biblioteca", async () => {
    buscarEnBiblioteca.mockResolvedValue([
      { id: 7, term: "bank", translation: "orilla", level: "B1", senseHint: "An edge of a river." },
    ]);
    buscarEnDiccionario.mockResolvedValue([
      { id: 1, term: "bank", pos: "noun", gloss: "An edge of a river.", example: null, translations: [] },
      { id: 2, term: "bank", pos: "noun", gloss: "A financial institution.", example: null, translations: [] },
    ]);

    const cuerpo = await (await pide("bank")).json();
    expect(cuerpo.acepciones[0].yaGuardada).toBe(true);
    expect(cuerpo.acepciones[1].yaGuardada).toBe(false);
    expect(cuerpo.enBiblioteca).toHaveLength(1);
  });

  it("un término desconocido responde 200 con las listas vacías", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);

    const res = await pide("xyzzy");
    expect(res.status).toBe(200);
    expect((await res.json()).acepciones).toEqual([]);
  });

  it("devuelve los significados en español, ordenados por categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    // A propósito en orden inverso al de la escala: el verbo va después del
    // sustantivo en pantalla, lo devuelva la base en el orden que lo devuelva.
    buscarSignificadosEspanoles.mockResolvedValue([
      { term: "dog", pos: "verb", meanings: ["Acosar."], source: "wikcionario-es" },
      { term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
    ]);

    const cuerpo = await (await pide("dog")).json();

    expect(cuerpo.significados.map((g: { pos: string }) => g.pos)).toEqual(["noun", "verb"]);
    expect(cuerpo.significados[0]).toMatchObject({
      nombre: "Sustantivo",
      meanings: ["Perro."],
      source: "wikcionario-es",
    });
  });

  it("enseña como mucho cinco significados por categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    buscarSignificadosEspanoles.mockResolvedValue([
      {
        term: "language",
        pos: "noun",
        meanings: ["Uno.", "Dos.", "Tres.", "Cuatro.", "Cinco.", "Seis.", "Siete."],
        source: "wikcionario-es",
      },
    ]);

    const cuerpo = await (await pide("language")).json();

    expect(cuerpo.significados[0].meanings).toHaveLength(5);
    expect(cuerpo.significados[0].meanings.at(-1)).toBe("Cinco.");
  });

  /**
   * El grupo de MyMemory llega sin categoría, y así se queda: inventarle una
   * sería decir que el traductor dijo algo que no dijo.
   */
  it("el grupo sin categoría sale sin nombre de categoría", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    buscarSignificadosEspanoles.mockResolvedValue([
      { term: "turn down", pos: "", meanings: ["rechazar"], source: "mymemory" },
    ]);

    const cuerpo = await (await pide("turn down")).json();

    expect(cuerpo.significados[0].nombre).toBe("");
    expect(cuerpo.significados[0].source).toBe("mymemory");
  });

  /**
   * El escalón que cuesta cuota solo se pisa cuando los gratuitos no dieron
   * nada. Llamarlo teniendo ya el español sería gastar caracteres para tirarlos.
   */
  it("le pasa al traductor lo que ya se encontró, para que decida si hace falta", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);
    const encontrados = [
      { term: "dog", pos: "noun", meanings: ["Perro."], source: "wikcionario-es" },
    ];
    buscarSignificadosEspanoles.mockResolvedValue(encontrados);

    await pide("dog");

    expect(completarConTraductor).toHaveBeenCalled();
    expect(completarConTraductor.mock.calls.at(-1)?.[2]).toEqual(encontrados);
  });

  it("sin español en ningún origen, la lista viene vacía en vez de faltar", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([]);

    const cuerpo = await (await pide("xyzzy")).json();

    expect(cuerpo.significados).toEqual([]);
  });

  /**
   * Lo que arregla esta prueba: que el traductor gratuito se cuelgue o se le
   * acabe la cuota no puede tumbar la búsqueda. `completarConTraductor` puede
   * devolver vacío —es justo lo que hace cuando el traductor no da nada—, pero
   * la ficha del diccionario ya tenía su significado y su ejemplo en inglés
   * listos para enseñar, y tienen que llegar igual, con 200.
   */
  it("si el traductor no da nada, la acepción llega igual con su significado y su ejemplo", async () => {
    buscarEnBiblioteca.mockResolvedValue([]);
    buscarEnDiccionario.mockResolvedValue([
      {
        id: 1,
        term: "dog",
        pos: "noun",
        gloss: "A domesticated carnivorous mammal.",
        example: "The dog barked at the mailman.",
        translations: [],
      },
    ]);
    completarConTraductor.mockResolvedValueOnce([]);

    const res = await pide("dog");
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(cuerpo.acepciones).toEqual([
      {
        id: 1,
        term: "dog",
        pos: "noun",
        gloss: "A domesticated carnivorous mammal.",
        example: "The dog barked at the mailman.",
        translations: [],
        yaGuardada: false,
      },
    ]);
    expect(cuerpo.significados).toEqual([]);
  });
});

/**
 * Si la consulta falla —la tabla del diccionario no existe porque nadie aplicó
 * las migraciones, por ejemplo— la ruta no puede dejar que la excepción suba:
 * Next devolvería un 500 con cuerpo HTML, el navegador reventaría al leerlo
 * como JSON, y el usuario acabaría viendo un mensaje interno del navegador.
 */
describe("cuando la base de datos falla", () => {
  it("responde 500 con un JSON que explica qué pasó", async () => {
    buscarEnBiblioteca.mockRejectedValue(
      new Error('relation "dictionary_entries" does not exist'),
    );
    buscarEnDiccionario.mockResolvedValue([]);

    const res = await pide("bank");

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const cuerpo = await res.json();
    expect(cuerpo.error).toMatch(/no se pudo buscar/i);
  });

  it("el mensaje menciona las migraciones, que es la causa más probable", async () => {
    buscarEnDiccionario.mockRejectedValue(
      new Error('relation "dictionary_entries" does not exist'),
    );
    buscarEnBiblioteca.mockResolvedValue([]);

    const cuerpo = await (await pide("bank")).json();
    expect(cuerpo.error).toMatch(/migraciones|diccionario/i);
  });
});
