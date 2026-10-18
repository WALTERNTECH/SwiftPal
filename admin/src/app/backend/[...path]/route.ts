import type { NextRequest } from "next/server";

// The only way into the API's admin routes from a browser. Runs on the
// console's server, forwards the session cookie, and adds the gateway secret
// the API checks. Anything outside /admin and /health is refused.

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const GATEWAY = process.env.ADMIN_GATEWAY_SECRET ?? "";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map(encodeURIComponent).join("/");
  if (!(joined === "health" || joined.startsWith("admin/"))) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });

  const headers = new Headers();
  for (const h of ["cookie", "content-type", "x-requested-with", "user-agent", "x-forwarded-for"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (GATEWAY) headers.set("x-admin-gateway", GATEWAY);

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
