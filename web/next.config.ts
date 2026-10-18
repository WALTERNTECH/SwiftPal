import type { NextConfig } from "next";

// The dashboard talks to the API through its own route at /backend
// (src/app/backend/[...path]/route.ts), so the session cookie stays httpOnly
// on the web domain and the API sees each visitor's real address.
// Public addresses shown in docs, snippets and links. Render hosts until the .com is live.
const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? (process.env.API_URL || "https://swiftpal-api.onrender.com");
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? process.env.RENDER_EXTERNAL_URL ?? "https://swiftpal-web.onrender.com";
const dev = process.env.NODE_ENV !== "production";

/**
 * Everything is served from this origin. The one cross-origin call is the
 * browser waking the API on Render (a no-cors GET to /health). No frames, no
 * plugins, no forms posting elsewhere: the connect approval page can't be
 * framed and clicked through.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${new URL(PUBLIC_API_URL).origin}${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: PUBLIC_API_URL,
    NEXT_PUBLIC_WEB_URL: PUBLIC_WEB_URL,
    NEXT_PUBLIC_MAIL_DOMAIN: process.env.MAIL_DOMAIN ?? "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
