/** Un decimal; si termina en ",0" se recorta; singular si el número es exactamente 1. */
function formatUnidad(cantidad: number, singular: string, plural: string): string {
  const conDecimal = cantidad.toFixed(1);
  const texto = conDecimal.endsWith(".0") ? conDecimal.slice(0, -2) : conDecimal;
  const esUno = texto === "1";
  return `${texto.replace(".", ",")} ${esUno ? singular : plural}`;
}

/**
 * "1 min", "10 min", "8 días", "1,3 años". Nunca se escriben a mano.
 *
 * Vive en `lib/` y no en `db/repository/review.ts`, de donde salió, porque
 * también lo usa el buscador del diccionario, que es un componente de cliente:
 * importarlo desde el repositorio arrastraría drizzle, el esquema y ts-fsrs al
 * navegador solo para formatear una fecha.
 */
export function formatearPlazo(desde: Date, hasta: Date): string {
  const minutos = Math.round((hasta.getTime() - desde.getTime()) / 60000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.round(minutos / 1440);
  if (dias < 30) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = dias / 30.4;
  if (meses < 12) return formatUnidad(meses, "mes", "meses");
  return formatUnidad(dias / 365, "año", "años");
}
