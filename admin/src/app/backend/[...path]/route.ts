import type { NextRequest } from "next/server";

// The only way into the API's admin routes from a browser. Runs on the
// console's server, forwards the session cookie, and adds the gateway secret
// the API checks. Anything outside /admin and /health is refused.

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const GATEWAY = process.env.ADMIN_GATEWAY_SECRET ?? "";
// Render appends its own proxies to X-Forwarded-For after the visitor's address; this many sit to its right.
const HOPS = Number(process.env.PROXY_HOPS ?? 2);

/** The admin's own address, for the audit log and sign-in lockouts. */
function visitor(req: NextRequest) {
  const chain = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1 - HOPS] ?? chain[0] ?? "";
}

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map(encodeURIComponent).join("/");
  if (!(joined === "health" || joined.startsWith("admin/"))) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });

  const headers = new Headers();
  for (const h of ["cookie", "content-type", "x-requested-with", "user-agent"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (GATEWAY) {
    headers.set("x-admin-gateway", GATEWAY);
    const ip = visitor(req);
    if (ip) {
      headers.set("x-swiftpal-proxy", GATEWAY);
      headers.set("x-swiftpal-client-ip", ip);
    }
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
  for (const h of ["content-type", "content-disposition", "cache-control", "x-request-id"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
