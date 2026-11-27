import type { MetadataRoute } from "next";

/**
 * TEa.G3 public sitemap. Prefer the configured canonical URL, then the
 * Vercel production domain, then the current deployment URL. This keeps
 * preview and production sitemaps from pointing at the retired Canvix host.
 */
const SITE_ORIGIN =
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
