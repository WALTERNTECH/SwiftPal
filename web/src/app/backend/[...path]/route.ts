import type { NextRequest } from "next/server";

// The dashboard's only way to the API. It runs on the web server, forwards
// the session cookie, and passes the visitor's address with a secret the API
// checks, so rate limits and the sessions list see the real person rather
// than this server. Only the dashboard's own routes go through.

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SECRET = process.env.WEB_PROXY_SECRET ?? "";
// Render appends its own proxies to X-Forwarded-For after the visitor's address; this many sit to its right.
const HOPS = Number(process.env.PROXY_HOPS ?? 2);
const ALLOWED = /^(health|app\/.+|pay\/.+)$/;
const FORWARD = ["cookie", "content-type", "x-requested-with", "user-agent", "accept", "idempotency-key"];
const RETURN = ["content-type", "content-disposition", "cache-control", "x-request-id", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining"];

export const dynamic = "force-dynamic";

function visitor(req: NextRequest) {
  const chain = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1 - HOPS] ?? chain[0] ?? "";
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map(encodeURIComponent).join("/");
  if (!ALLOWED.test(joined)) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });

  const headers = new Headers();
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = visitor(req);
  if (SECRET && ip) {
    headers.set("x-swiftpal-proxy", SECRET);
    headers.set("x-swiftpal-client-ip", ip);
  }

  let res: Response;
  try {
    res = await fetch(`${API}/${joined}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const out = new Headers();
  for (const h of RETURN) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE, forward as PUT };
