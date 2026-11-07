import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poker",
    short_name: "Poker",
    description: "Texas Hold'em între prieteni, pe telefon.",
    id: "/poker/",
    start_url: "/poker/",
    // "/" on purpose: leaving the game for the hub stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/poker/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/poker/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/poker/pwa-icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
