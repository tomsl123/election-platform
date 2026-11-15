import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed, Libre_Caslon_Text } from "next/font/google";
import "./globals.css";

const caslon = Libre_Caslon_Text({ weight: ["400", "700"], style: ["normal", "italic"], subsets: ["latin", "latin-ext"], variable: "--font-caslon", display: "swap" });
const cond = IBM_Plex_Sans_Condensed({ weight: ["500", "600"], subsets: ["latin", "latin-ext"], variable: "--font-cond", display: "swap" });
const mono = IBM_Plex_Mono({ weight: ["500"], subsets: ["latin", "latin-ext"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Polling Station", template: "%s · Polling Station" },
  description: "Elections and referendums.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#4b311a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caslon.variable} ${cond.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
