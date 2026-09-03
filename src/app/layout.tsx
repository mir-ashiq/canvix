import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Canvix — Design anything, free forever",
  description:
    "Canvix is a free & open-source graphic design tool. Create social posts, presentations, posters, logos and more with a drag-and-drop editor that works on desktop, tablet and mobile.",
  keywords: [
    "canvix",
    "design tool",
    "open source",
    "canva alternative",
    "graphic design",
    "templates",
    "drag and drop editor",
  ],
  authors: [{ name: "Ashiq Hussain Mir" }],
  icons: { icon: "/canvix.svg" },
  openGraph: {
    title: "Canvix — Design anything, free forever",
    description:
      "Free & open-source graphic design tool. A community-built Canva alternative.",
    siteName: "Canvix",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#00C4CC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 60-family design font library (Google Fonts) — subset weights for performance */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout applies to all pages */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@400;600;700;800&family=Montserrat:wght@600;700;800;900&family=Space+Grotesk:wght@500;700&family=Oswald:wght@500;700&family=Raleway:wght@400;700&family=Lato:wght@400;700&family=Open+Sans:wght@400;700&family=Nunito:wght@400;700&family=Quicksand:wght@400;700&family=Rubik:wght@400;700&family=Work+Sans:wght@400;700&family=DM+Sans:wght@400;700&family=Josefin+Sans:wght@400;700&family=Barlow:wght@400;700&family=Manrope:wght@400;700&family=Outfit:wght@400;700&family=Figtree:wght@400;700&family=Playfair+Display:wght@400;700;800&family=Abril+Fatface&family=Roboto+Slab:wght@400;700&family=Lora:wght@400;700&family=Merriweather:wght@400;700&family=Libre+Baskerville:wght@400;700&family=EB+Garamond:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=DM+Serif+Display&family=Prata&family=Bitter:wght@400;700&family=Fraunces:wght@400;700&family=Bodoni+Moda:wght@400;700&family=Cinzel:wght@400;700&family=Bebas+Neue&family=Anton&family=Archivo+Black&family=Lobster&family=Alfa+Slab+One&family=Bungee&family=Righteous&family=Ultra&family=Passion+One:wght@400;700&family=Monoton&family=Rye&family=Titan+One&family=Luckiest+Guy&family=Permanent+Marker&family=Pacifico&family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Sacramento&family=Satisfy&family=Kaushan+Script&family=Alex+Brush&family=Allura&family=Parisienne&family=Amatic+SC:wght@400;700&family=Shadows+Into+Light&family=Indie+Flower&family=Kalam:wght@400;700&family=DM+Mono:wght@400;500&family=JetBrains+Mono:wght@400;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
