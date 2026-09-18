import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ayacucho Hoy",
  description:
    "Buscador de acontecimientos locales — corrupción, seguridad, protestas y medio ambiente en Ayacucho, en un solo lugar.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
