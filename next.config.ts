import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // pdf-parse pulls in canvas as an optional dependency for PDF rendering.
    // We only need text extraction, so stub canvas out entirely to avoid
    // "DOMMatrix is not defined" and related runtime errors in Node.js.
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
