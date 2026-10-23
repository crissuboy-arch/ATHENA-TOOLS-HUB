import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Athena Tools Hub",
    template: "%s · Athena Tools Hub",
  },
  description:
    "Plataforma de ferramentas de IA: catálogo, execuções, aprovações, resultados e integrações — com governança pronta para Athena Control.",
  applicationName: "Athena Tools Hub",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Athena Tools Hub",
  },
};

/**
 * FASE 2B (C10): `themeColor` saiu de `metadata` (deprecated desde o
 * Next 14; o build avisava) para o export `viewport` — mesma cor
 * (#0A1A33), comportamento visual idêntico.
 */
export const viewport: Viewport = {
  themeColor: "#0A1A33",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
