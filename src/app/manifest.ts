import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poker",
    short_name: "Poker",
    description: "Texas Hold'em între prieteni, pe telefon.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
