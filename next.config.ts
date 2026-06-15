import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // Keep heavy Node-only libraries out of the bundler; load them at runtime.
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "@prisma/client",
    "prisma",
    "cheerio",
    "postcss",
    "@anthropic-ai/sdk",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "inngest",
  ],
};

export default nextConfig;
