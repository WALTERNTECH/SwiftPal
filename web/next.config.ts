import type { NextConfig } from "next";

// The dashboard talks to the API through this same-origin proxy, so the
// session cookie stays httpOnly on the web domain. API_URL is read at build.
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // The proxy buffers request bodies; verification sends up to four 10 MB photos.
    proxyClientMaxBodySize: "42mb",
  },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
