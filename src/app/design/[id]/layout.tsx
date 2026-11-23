import type { Metadata } from "next";

/**
 * v0.23.3 (SEO): /design/<id> are per-user share links, not public
 * content — private designs must never appear in search results. The page
 * itself is 'use client' (v0.11.4 deep links), so the route-level layout
 * is where the robots directive lives.
 */
export const metadata: Metadata = {
  title: "Design",
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
