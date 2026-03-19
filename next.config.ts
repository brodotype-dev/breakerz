import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Stub out canvas (optional pdf-parse dependency) for both bundlers.
  // We only need text extraction — no rendering APIs required.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: path.resolve("./lib/empty-module.js"),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      canvas: "./lib/empty-module.js",
    },
  },
};

export default nextConfig;
