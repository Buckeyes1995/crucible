import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip static prerendering — all pages are client-rendered
  staticPageGenerationTimeout: 1,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:7777/api/:path*" },
      { source: "/v1/:path*", destination: "http://localhost:7777/v1/:path*" },
      { source: "/ws/:path*", destination: "http://localhost:7777/ws/:path*" },
    ];
  },
};

export default nextConfig;
