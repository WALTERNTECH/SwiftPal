// Every setting the API reads, in one place. Secrets come from the
// environment only; nothing here has a usable default for production.

export type DarajaEnv = "sandbox" | "production";

export type Config = {
  env: "development" | "test" | "production";
  port: number;
  /** Public base URL of this API, used to build Daraja callback URLs. */
  publicUrl: string;
  /** Origin of the dashboard, for links in emails. */
  webUrl: string;
  databaseUrl: string | null;
  /** 32-byte key (hex or base64) for encrypting passkeys, webhook secrets and ID numbers. */
  masterKey: Buffer;
  /** Shared secret in Daraja callback paths. Safaricom signs nothing, so the path is the gate. */
  callbackToken: string;
  adminToken: string | null;
  /** Shared with the admin console's server; admin routes refuse browser sessions that didn't come through it. */
  adminGateway: string | null;
  /** Bearer ADMIN_TOKEN on /admin for scripts. Off in production unless ADMIN_API=on: it skips two-step sign-in. */
  adminApi: boolean;
  /** Shared with the web app's server, which passes the visitor's address in X-SwiftPal-Client-IP. */
  proxySecret: string | null;
  /** Safaricom's callback addresses. When set, Daraja callbacks from anywhere else are refused. */
  callbackIps: string[];
  /** Live payouts and withdrawals a merchant may send per Nairobi day, unless the console sets their own. */
  payoutDailyLimitCents: number;
  resendApiKey: string | null;
  mailFrom: string;
  /**
   * One-time codes: phone and email at sign-up, SMS at sign-in, SMS before live
   * money leaves from the dashboard. Off until SMS and email providers are set.
   */
  codes: boolean;
  /** Africa's Talking SMS for sign-up, sign-in and money-movement codes. Null logs messages instead. */
  sms: { username: string; apiKey: string; senderId: string | null } | null;
  allowPrivateWebhooks: boolean;
  storage: { driver: "db" } | { driver: "supabase"; url: string; serviceKey: string; bucket: string };
  daraja: {
    env: DarajaEnv;
    consumerKey: string;
    consumerSecret: string;
    /** M-Pesa Express shortcode and passkey used for top-ups and for channels not linked with their own passkey. */
    stkShortcode: string;
    stkPasskey: string;
    /** B2C shortcode that holds merchants' payout float. */
    b2cShortcode: string;
    initiatorName: string;
    /** Initiator password already encrypted with Safaricom's certificate (Daraja portal generates it). */
    securityCredential: string;
    /** Re-read every success callback with STK Query before trusting it. */
    confirmStk: boolean;
  } | null;
  sandboxDelayMs: number;
};

function key(raw: string | undefined, env: Config["env"]): Buffer {
  if (raw) {
    const b = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (b.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (64 hex chars or base64)");
    return b;
  }
  if (env === "production") throw new Error("MASTER_KEY is required in production");
  return Buffer.alloc(32, 7); // development and tests only
}

export function loadConfig(e: NodeJS.ProcessEnv = process.env): Config {
  const env = (e.NODE_ENV === "production" ? "production" : e.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  const darajaReady = e.DARAJA_CONSUMER_KEY && e.DARAJA_CONSUMER_SECRET;
  const cfg: Config = {
    env,
    port: Number(e.PORT ?? 4000),
    publicUrl: (e.PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, ""),
    webUrl: (e.WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    databaseUrl: e.DATABASE_URL ?? null,
    masterKey: key(e.MASTER_KEY, env),
    callbackToken: e.CALLBACK_TOKEN ?? (env === "production" ? "" : "dev-callback-token"),
    adminToken: e.ADMIN_TOKEN ?? null,
    adminGateway: e.ADMIN_GATEWAY_SECRET || null,
    adminApi: env !== "production" || e.ADMIN_API === "on",
    proxySecret: e.WEB_PROXY_SECRET || null,
    callbackIps: (e.DARAJA_CALLBACK_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    payoutDailyLimitCents: Math.round(Number(e.PAYOUT_DAILY_LIMIT_KES ?? 500_000) * 100),
    resendApiKey: e.RESEND_API_KEY ?? null,
    mailFrom: e.MAIL_FROM ?? "SwiftPal <onboarding@resend.dev>",
    codes: e.VERIFICATION_CODES === "on",
    sms: e.AT_USERNAME && e.AT_API_KEY ? { username: e.AT_USERNAME, apiKey: e.AT_API_KEY, senderId: e.AT_SENDER_ID || null } : null,
    allowPrivateWebhooks: e.ALLOW_PRIVATE_WEBHOOKS === "true" && env !== "production",
    storage:
      e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY
        ? { driver: "supabase", url: e.SUPABASE_URL.replace(/\/$/, ""), serviceKey: e.SUPABASE_SERVICE_ROLE_KEY, bucket: e.STORAGE_BUCKET ?? "swiftpal-kyc" }
        : { driver: "db" },
    daraja: darajaReady
      ? {
          env: e.DARAJA_ENV === "production" ? "production" : "sandbox",
          consumerKey: e.DARAJA_CONSUMER_KEY!,
          consumerSecret: e.DARAJA_CONSUMER_SECRET!,
          stkShortcode: e.DARAJA_STK_SHORTCODE ?? "",
          stkPasskey: e.DARAJA_STK_PASSKEY ?? "",
          b2cShortcode: e.DARAJA_B2C_SHORTCODE ?? "",
          initiatorName: e.DARAJA_INITIATOR_NAME ?? "",
          securityCredential: e.DARAJA_SECURITY_CREDENTIAL ?? "",
          confirmStk: e.DARAJA_CONFIRM_STK !== "false",
        }
      : null,
    sandboxDelayMs: Number(e.SANDBOX_DELAY_MS ?? 4500),
  };
  if (env === "production") {
    if (!cfg.databaseUrl) throw new Error("DATABASE_URL is required in production");
    if (cfg.callbackToken.length < 24) throw new Error("CALLBACK_TOKEN must be at least 24 characters in production");
  }
  return cfg;
}
