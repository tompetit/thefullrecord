import type { Metadata } from "next";
import { Source_Serif_4, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "The Full Record",
  description:
    "Look up any U.S. address to explore your representatives’ recorded votes by issue, and read sourced candidate research for New York and U.S. House and Senate races. Coverage has limits; we show them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-ink px-4 py-3 font-sans text-sm font-semibold text-paper focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to main content
        </a>
        <SiteHeader />
        {/* Skip-link target for every page (pages render their own <main>). */}
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </div>
        <SiteFooter />
        <SiteAnalytics />
      </body>
    </html>
  );
}
