import { NextResponse } from "next/server";
import { getDueQueue } from "@/db/repository/review";
import { esModo } from "@/lib/ajustes";
import { getDb } from "@/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modo = url.searchParams.get("modo");
  const cuantas = url.searchParams.get("cuantas");
  // `URLSearchParams.get` devuelve "" —no null— con `?cuantas=` sin valor, y
  // `Number("")` es 0. Tratarlo como el 0 explícito activaría el tope diario
  // en vez del tamaño de sesión guardado, así que un valor vacío se trata
  // igual que uno ausente.
  const numero = cuantas === null || cuantas === "" ? undefined : Number(cuantas);

  // Un parámetro ilegible no se ignora en silencio: sin esto, un `cuantas=hola`
  // daría NaN, `componerSesion` no recortaría nada y el usuario recibiría una
  // sesión distinta de la que pidió sin que nada se lo dijera.
  if (numero !== undefined && (!Number.isInteger(numero) || numero < 0)) {
    return NextResponse.json(
      { error: "El número de tarjetas debe ser un entero no negativo." },
      { status: 400 },
    );
  }

  // Se devuelve la cola entera: `cartas`, `repasosFuera` y `enCursoFuera`. Los
  // dos recuentos van por separado porque la pantalla no solo dice cuánto
  // quedó fuera de la sesión: también decide con qué modo sigue el botón, y
  // ningún modo trae las dos colecciones por separado (ver `VencidosFuera`).
  const cola = await getDueQueue(getDb(), {
    now: new Date(),
    source: url.searchParams.get("source") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    modo: esModo(modo) ? modo : undefined,
    cuantas: numero,
  });
  return NextResponse.json(cola);
}
