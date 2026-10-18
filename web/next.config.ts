import type { NextConfig } from "next";

// The dashboard talks to the API through this same-origin proxy, so the
// session cookie stays httpOnly on the web domain. API_URL is read at build.
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
// Public addresses shown in docs, snippets and links. Render hosts until the .com is live.
const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? (process.env.API_URL || "https://swiftpal-api.onrender.com");
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? process.env.RENDER_EXTERNAL_URL ?? "https://swiftpal-web.onrender.com";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: PUBLIC_API_URL,
    NEXT_PUBLIC_WEB_URL: PUBLIC_WEB_URL,
    NEXT_PUBLIC_MAIL_DOMAIN: process.env.MAIL_DOMAIN ?? "",
  },
  experimental: {
    // The proxy buffers request bodies; verification sends up to four 10 MB photos.
    proxyClientMaxBodySize: "42mb",
  },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
