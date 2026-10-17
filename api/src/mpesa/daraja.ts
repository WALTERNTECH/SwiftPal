import { darajaTimestamp } from "../lib.js";
import { MpesaRejected, type B2cRequest, type MpesaDriver, type StkRequest } from "./types.js";

type Cfg = {
  env: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  b2cShortcode: string;
  initiatorName: string;
  securityCredential: string;
};

const BASE = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" };

/**
 * Safaricom Daraja over HTTPS. Tokens are cached until a minute before they
 * expire; one refresh is shared by concurrent callers.
 */
export class DarajaClient implements MpesaDriver {
  readonly name = "daraja" as const;
  private token: { value: string; until: number } | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private cfg: Cfg,
    private http: typeof fetch = fetch,
  ) {}

  private get base() {
    return BASE[this.cfg.env];
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const auth = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString("base64");
      const res = await this.http(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string | number };
      if (!res.ok || !body.access_token) throw new MpesaRejected("oauth_failed", `Daraja OAuth failed with HTTP ${res.status}`, true);
      const ttl = Number(body.expires_in ?? 3599) * 1000;
      this.token = { value: body.access_token, until: Date.now() + ttl - 60_000 };
      return body.access_token;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const send = async () =>
      this.http(`${this.base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    let res = await send();
    if (res.status === 401) {
      this.token = null; // revoked or expired early; one retry with a fresh token
      res = await send();
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || (body.ResponseCode !== undefined && String(body.ResponseCode) !== "0")) {
      const code = String(body.errorCode ?? body.ResponseCode ?? res.status);
      const msg = String(body.errorMessage ?? body.ResponseDescription ?? `HTTP ${res.status}`);
      throw new MpesaRejected(code, msg, res.status >= 500 || res.status === 429);
    }
    return body as T;
  }

  static password(shortcode: string, passkey: string, timestamp: string) {
    return Buffer.from(shortcode + passkey + timestamp).toString("base64");
  }

  async stkPush(r: StkRequest) {
    const timestamp = darajaTimestamp();
    const body = await this.post<{ MerchantRequestID: string; CheckoutRequestID: string }>("/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: r.businessShortCode,
      Password: DarajaClient.password(r.businessShortCode, r.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: r.transactionType,
      Amount: r.amount,
      PartyA: r.phone,
      PartyB: r.partyB,
      PhoneNumber: r.phone,
      CallBackURL: r.callbackUrl,
      AccountReference: r.accountReference.slice(0, 12),
      TransactionDesc: r.description.slice(0, 13),
    });
    return { merchantRequestId: body.MerchantRequestID, checkoutRequestId: body.CheckoutRequestID };
  }

  async stkQuery(r: { businessShortCode: string; passkey: string; checkoutRequestId: string }) {
    const timestamp = darajaTimestamp();
    try {
      const body = await this.post<{ ResultCode?: string | number; ResultDesc?: string }>("/mpesa/stkpushquery/v1/query", {
        BusinessShortCode: r.businessShortCode,
        Password: DarajaClient.password(r.businessShortCode, r.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: r.checkoutRequestId,
      });
      return { resultCode: body.ResultCode === undefined ? null : String(body.ResultCode), resultDesc: String(body.ResultDesc ?? "") };
    } catch (e) {
      // 500.001.1001 is "the transaction is being processed": not an answer yet.
      if (e instanceof MpesaRejected && e.code === "500.001.1001") return { resultCode: null, resultDesc: e.message };
      throw e;
    }
  }

  async b2c(r: B2cRequest) {
    const body = await this.post<{ ConversationID: string; OriginatorConversationID: string }>("/mpesa/b2c/v3/paymentrequest", {
      OriginatorConversationID: r.originatorConversationId,
      InitiatorName: this.cfg.initiatorName,
      SecurityCredential: this.cfg.securityCredential,
      CommandID: r.commandId,
      Amount: r.amount,
      PartyA: this.cfg.b2cShortcode,
      PartyB: r.phone,
      Remarks: r.remarks.slice(0, 100) || "Payout",
      QueueTimeOutURL: r.timeoutUrl,
      ResultURL: r.resultUrl,
      Occasion: r.occasion.slice(0, 100),
    });
    return { conversationId: body.ConversationID, originatorConversationId: body.OriginatorConversationID ?? r.originatorConversationId };
  }
}
