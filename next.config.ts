import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // v0.6.1: strict again — the codebase typechecks clean; keep it that way.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
