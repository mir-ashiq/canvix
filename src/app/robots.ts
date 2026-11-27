import type { MetadataRoute } from "next";

const SITE_ORIGIN =
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "Googlebot", allow: "/", disallow: ["/api/", "/design/", "/admin"] },
      { userAgent: "Bingbot", allow: "/", disallow: ["/api/", "/design/", "/admin"] },
      { userAgent: "Twitterbot", allow: "/", disallow: ["/api/"] },
      { userAgent: "facebookexternalhit", allow: "/", disallow: ["/api/"] },
      { userAgent: "*", allow: "/", disallow: ["/api/", "/design/", "/admin"] },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
