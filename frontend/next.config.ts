import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip static prerendering — all pages are client-rendered
  staticPageGenerationTimeout: 1,
  // Disable Next's built-in gzip — it buffers SSE streams and delays events
  // until ~4KB accumulates, making benchmark/chat/load progress feel frozen.
  compress: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:7777/api/:path*" },
      { source: "/v1/:path*", destination: "http://localhost:7777/v1/:path*" },
      { source: "/ws/:path*", destination: "http://localhost:7777/ws/:path*" },
    ];
  },
};

export default nextConfig;
