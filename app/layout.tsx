import type { Metadata, Viewport } from "next";
import { Fraunces, Bricolage_Grotesque } from "next/font/google";
import { BarraNavegacion } from "@/components/ui/BarraNavegacion";
import { EntradaApp } from "@/components/ui/EntradaApp";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--fuente-serif",
  subsets: ["latin"],
});

const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--fuente-ui",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vocably",
  description:
    "Extrae vocabulario en inglés de un PDF con la API de Claude y guárdalo para repasarlo.",
};

export const viewport: Viewport = {
  themeColor: "#E1552C",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${fraunces.variable} ${bricolageGrotesque.variable} h-full antialiased`}
    >
      {/* La barra va aquí y no en cada página: una sola lista de destinos, y
          ninguna pantalla puede volver a olvidarse de enlazar a otra. Decide
          ella misma si le toca salir, así que en `/login` no aparece. */}
      <body className="min-h-full flex flex-col">
        {children}
        <BarraNavegacion />
        <EntradaApp />
      </body>
    </html>
  );
}
