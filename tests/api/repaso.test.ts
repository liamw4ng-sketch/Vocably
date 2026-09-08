import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/tests/helpers/test-db";
import { saveExtraction } from "@/db/repository/extraction";
import { setNewCardsPerDay, setSessionMode, setSessionSize } from "@/db/repository/settings";

let db: TestDb;
let closeDb: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

import { GET } from "@/app/api/repaso/cola/route";
import { POST } from "@/app/api/repaso/respuesta/route";

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  closeDb = t.close;
  await saveExtraction(db, {
    title: "Libro",
    pageStart: 1,
    pageEnd: 5,
    level: "B2",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    items: [
      {
        term: "come across",
        type: "phrasal_verb",
        translation: "encontrarse con",
        context: "I came across a photo.",
        example: "She came across an article.",
      },
    ],
  });
});
afterEach(async () => {
  await closeDb();
});

function post(body: unknown) {
  return new Request("http://localhost/api/repaso/respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/repaso/cola", () => {
  it("devuelve las cartas del día", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cartas).toHaveLength(1);
    expect(body.cartas[0].term).toBe("come across");
  });

  it("responder toda la cola gasta el tope diario, y la siguiente recarga llega vacía", async () => {
    // El beforeEach ya guardó un término ("come across"); se añaden más para
    // tener 10 nuevas disponibles en total con las que distinguir "se acabó
    // el cupo de hoy" de "no queda ninguna carta por delante": si el tope no
    // se arrastrara entre peticiones, aquí seguirían saliendo cartas de las
    // 8 que quedan sin responder.
    await saveExtraction(db, {
      title: "Libro",
      pageStart: 1,
      pageEnd: 5,
      level: "B2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: Array.from({ length: 9 }, (_, i) => ({
        term: `palabra${i}`,
        type: "word" as const,
        translation: `traducción${i}`,
        context: `Frase con palabra${i}.`,
        example: `Ejemplo con palabra${i}.`,
      })),
    });
    await setNewCardsPerDay(db, 2);

    const primera = await GET(new Request("http://localhost/api/repaso/cola"));
    const cartas = (await primera.json()).cartas as { termId: number }[];
    expect(cartas).toHaveLength(2);

    // Se responden las dos: el cupo del día queda gastado. La ruta deriva
    // `now` del propio servidor (`new Date()`), no de nada que mande el
    // cliente, así que estas respuestas cuentan contra el día de hoy sin más;
    // y `introducidasHoy` arrastra esa cuenta a través del límite HTTP hasta
    // la petición siguiente.
    for (const carta of cartas) {
      await POST(post({ answerId: `a${carta.termId}`, termId: carta.termId, rating: 3 }));
    }
    const segunda = await GET(new Request("http://localhost/api/repaso/cola"));
    expect((await segunda.json()).cartas).toHaveLength(0);
  });

  it("un tamaño de sesión guardado manda sobre el tope diario de nuevas", async () => {
    // El equivalente de "adelantar nuevas" ya no es un parámetro aparte: es
    // pedir un tamaño de sesión explícito en modo "no-aprendidas", que manda
    // incluso por encima del tope diario (`getDueQueue`/`componerSesion`).
    // Esta ruta todavía no acepta `?modo=` ni `?cuantas=` en la URL —eso es
    // la Task 4—, así que se prueba a través de los ajustes guardados, que es
    // lo único que hoy puede fijar el modo y el tamaño de sesión.
    //
    // El beforeEach ya guardó un término ("come across"); se añaden más para
    // tener 10 nuevas disponibles en total con las que distinguir un tamaño
    // de sesión fijo de "todo lo que queda".
    await saveExtraction(db, {
      title: "Libro",
      pageStart: 1,
      pageEnd: 5,
      level: "B2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      items: Array.from({ length: 9 }, (_, i) => ({
        term: `palabra${i}`,
        type: "word" as const,
        translation: `traducción${i}`,
        context: `Frase con palabra${i}.`,
        example: `Ejemplo con palabra${i}.`,
      })),
    });
    await setNewCardsPerDay(db, 2);
    await setSessionMode(db, "no-aprendidas");
    await setSessionSize(db, 5);

    const res = await GET(new Request("http://localhost/api/repaso/cola"));
    const cartas = (await res.json()).cartas as { termId: number; esNueva: boolean }[];

    // El tope diario (2) queda ignorado: el tamaño de sesión pedido (5) manda.
    expect(cartas).toHaveLength(5);
    expect(cartas.every((c) => c.esNueva)).toBe(true);
  });

  it("acepta filtros por tipo", async () => {
    const res = await GET(new Request("http://localhost/api/repaso/cola?type=word"));
    expect((await res.json()).cartas).toHaveLength(0);
  });
});

describe("POST /api/repaso/respuesta", () => {
  it("registra una valoración", async () => {
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aplicada).toBe(true);
  });

  it("no permite que el cliente fije la fecha o el estado de la tarjeta", async () => {
    // El cuerpo trae campos que un cliente malicioso o con prisa podría enviar
    // para intentar controlar el resultado directamente. El servidor debe
    // ignorarlos por completo y calcular `now` con `new Date()`.
    const res = await POST(
      post({
        answerId: "a-extra",
        termId: 1,
        rating: 1,
        now: "2000-01-01T00:00:00.000Z",
        state: "Review",
        due: "2099-01-01T00:00:00.000Z",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aplicada).toBe(true);
    // Con rating 1 (Again) la próxima fecha siempre está muy cerca de ahora;
    // si el servidor hubiera honrado un `now`/`due` inventado del año 2000 o
    // 2099, esta comprobación fallaría.
    const proximaFecha = new Date(body.proximaFecha);
    const diffMinutos = Math.abs(proximaFecha.getTime() - Date.now()) / 60000;
    expect(diffMinutos).toBeLessThan(60);
  });

  it("una respuesta repetida responde 200 pero no la aplica dos veces", async () => {
    await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    const res = await POST(post({ answerId: "a1", termId: 1, rating: 3 }));
    expect(res.status).toBe(200);
    expect((await res.json()).aplicada).toBe(false);
  });

  it("rechaza una valoración fuera de 1..4", async () => {
    const res = await POST(post({ answerId: "b", termId: 1, rating: 7 }));
    expect(res.status).toBe(400);
  });

  it("rechaza una valoración que no es un número", async () => {
    const res = await POST(post({ answerId: "b2", termId: 1, rating: "3" }));
    expect(res.status).toBe(400);
  });

  it("rechaza un término que no es un número", async () => {
    const res = await POST(post({ answerId: "c", termId: "1", rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza una petición sin identificador de respuesta", async () => {
    const res = await POST(post({ termId: 1, rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza un identificador de respuesta vacío", async () => {
    const res = await POST(post({ answerId: "   ", termId: 1, rating: 3 }));
    expect(res.status).toBe(400);
  });

  it("rechaza un cuerpo mal formado", async () => {
    const res = await POST(
      new Request("http://localhost/api/repaso/respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{no es json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
