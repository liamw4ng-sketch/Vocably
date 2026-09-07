export type Traductor = (termino: string) => Promise<string[]>;

/**
 * Cinco segundos y se corta. El `catch` de abajo cubre un servicio caído, pero
 * no uno colgado: sin plazo, una petición que no responde nunca deja esperando
 * a la búsqueda entera y la usuaria pierde el significado y el ejemplo que ya
 * estaban listos, que es justo lo contrario de lo que promete la
 * especificación §8.
 */
const ESPERA_MS = 5000;

/**
 * MyMemory era, el 2026-09-07, el único traductor gratuito en pie: las
 * instancias públicas de LibreTranslate y las tres de Lingva probadas estaban
 * caídas. Cuota anónima: 5.000 caracteres al día; un término son unos diez.
 *
 * Se manda **el término solo**. Mandarlo junto a su definición para desambiguar
 * parece buena idea y no lo es: "come across: to give an impression" vuelve
 * traducido como "venir a través", partiendo el verbo frasal.
 *
 * Un fallo del servicio devuelve una lista vacía, nunca una excepción: que un
 * tercero se caiga —o se quede colgado, de ahí el plazo— no puede tumbar la
 * búsqueda, que ya tiene el significado y el ejemplo listos para enseñar.
 *
 * `esperaMs` solo se toca en las pruebas, para poder ejercitar de verdad el
 * caso del servicio colgado sin esperar cinco segundos.
 */
export function crearTraductorMyMemory(
  fetchImpl: typeof fetch = fetch,
  esperaMs: number = ESPERA_MS,
): Traductor {
  return async (termino: string) => {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", termino);
    url.searchParams.set("langpair", "en|es");

    try {
      const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(esperaMs) });
      if (!res.ok) return [];
      const cuerpo = (await res.json()) as {
        responseData?: { translatedText?: string };
        matches?: { translation?: string }[];
      };

      const candidatas = [
        cuerpo.responseData?.translatedText ?? "",
        ...(cuerpo.matches ?? []).map((m) => m.translation ?? ""),
      ];

      const vistas = new Set<string>();
      const traducciones: string[] = [];
      for (const bruta of candidatas) {
        const limpia = bruta.trim();
        if (!limpia || vistas.has(limpia.toLowerCase())) continue;
        vistas.add(limpia.toLowerCase());
        traducciones.push(limpia);
        if (traducciones.length === 3) break;
      }
      return traducciones;
    } catch {
      return [];
    }
  };
}
