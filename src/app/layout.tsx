import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Poker",
  applicationName: "Poker",
  // Metadata URLs are not basePath-prefixed automatically.
  icons: {
    icon: [{ url: "/poker/favicon.ico", sizes: "48x48", type: "image/x-icon" }],
    apple: [{ url: "/poker/pwa-icons/apple", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Poker", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  description: "Texas Hold'em între prieteni, pe telefon. Până la 16 jucători și 16 observatori.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
