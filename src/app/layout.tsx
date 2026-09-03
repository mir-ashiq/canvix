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
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout applies to all pages */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@400;600;700;800&family=Montserrat:wght@600;700;800;900&family=Space+Grotesk:wght@500;700&family=Oswald:wght@500;700&family=Bebas+Neue&family=Anton&family=Archivo+Black&family=Playfair+Display:wght@400;700;800&family=Abril+Fatface&family=Roboto+Slab:wght@400;700&family=Lobster&family=Pacifico&family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&display=swap"
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
