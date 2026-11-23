import type { MetadataRoute } from "next";

/**
 * v0.23.3 (SEO): the sitemap Google needs to index the site — previously
 * /sitemap.xml answered with the app shell (HTML), so Search Console had
 * nothing to read. Only `/` is a real public page: /design/<id> are
 * per-user share links (not crawlable content) and /admin is private,
 * both of which are marked noindex in their route layouts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://canvix.app";
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
