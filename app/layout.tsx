import type { Metadata } from "next";
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
  themeColor: "#0A1A33",
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
