import type { MetadataRoute } from "next";

// PWA manifest for Athena Tools Hub.
// TODO: replace the SVG icon with real 192px and 512px PNGs
// (public/icons/icon-192.png, public/icons/icon-512.png) before PWA install
// prompts are expected to work in all browsers.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Athena Tools Hub",
    short_name: "Tools Hub",
    description:
      "Plataforma de ferramentas de IA: catálogo, execuções, aprovações, resultados e integrações.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A1A33",
    theme_color: "#0A1A33",
    lang: "pt-BR",
    dir: "ltr",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
