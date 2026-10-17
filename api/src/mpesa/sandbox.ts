import { randomBytes } from "node:crypto";
import type { B2cRequest, B2cResult, MpesaDriver, StkRequest, StkResult } from "./types.js";

/** Test numbers that force an outcome, mirrored in the docs and the dashboard. */
export const SANDBOX_STK: Record<string, { code: string; desc: string }> = {
  "254700000001": { code: "1032", desc: "Request cancelled by user" },
  "254700000002": { code: "1", desc: "The balance is insufficient for the transaction" },
  "254700000003": { code: "1037", desc: "DS timeout user cannot be reached" },
};
export const SANDBOX_B2C_FAIL = new Set(["254700000001", "254700000002", "254700000003"]);

const NAMES = ["JOHN KAMAU", "MERCY WANJIKU", "BRIAN OTIENO", "FAITH CHEBET", "KEVIN MWANGI", "ANN NJERI", "DAVID KIPRONO", "GRACE AKINYI"];
const receipt = () => "T" + randomBytes(9).toString("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase().padEnd(9, "Q").slice(0, 9);

/**
 * SwiftPal's own sandbox: answers exactly like Daraja, then delivers the
 * result through the same handlers a real callback would reach.
 */
export class SandboxDriver implements MpesaDriver {
  readonly name = "sandbox" as const;
  private outcomes = new Map<string, StkResult>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(
    private handlers: { stk: (r: StkResult) => Promise<unknown>; b2c: (r: B2cResult) => Promise<unknown> },
    private delayMs = 4500,
  ) {}

  private later(fn: () => Promise<unknown>, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn().catch((e) => console.error("sandbox callback failed", e));
    }, ms);
    this.timers.add(t);
  }

  async stkPush(r: StkRequest) {
    const id = randomBytes(6).toString("hex").toUpperCase();
    const checkoutRequestId = `ws_CO_SBX_${id}`;
    const merchantRequestId = `SBX-${id}`;
    const forced = SANDBOX_STK[r.phone];
    const result: StkResult = forced
      ? { checkoutRequestId, merchantRequestId, resultCode: forced.code, resultDesc: forced.desc }
      : { checkoutRequestId, merchantRequestId, resultCode: "0", resultDesc: "The service request is processed successfully.", receipt: receipt(), amount: r.amount, phone: r.phone };
    this.later(async () => {
      this.outcomes.set(checkoutRequestId, result);
      await this.handlers.stk(result);
    }, forced?.code === "1037" ? this.delayMs * 2 : this.delayMs);
    return { merchantRequestId, checkoutRequestId };
  }

  async stkQuery(r: { checkoutRequestId: string }) {
    const o = this.outcomes.get(r.checkoutRequestId);
    return o ? { resultCode: o.resultCode, resultDesc: o.resultDesc } : { resultCode: null, resultDesc: "The transaction is being processed" };
  }

  async b2c(r: B2cRequest) {
    const conversationId = `AG_SBX_${randomBytes(6).toString("hex").toUpperCase()}`;
    const fails = SANDBOX_B2C_FAIL.has(r.phone);
    const name = NAMES[parseInt(r.phone.slice(-2), 10) % NAMES.length];
    this.later(
      () =>
        this.handlers.b2c(
          fails
            ? { originatorConversationId: r.originatorConversationId, conversationId, resultCode: "2040", resultDesc: "Credit Party customer type can't be supported by the service." }
            : { originatorConversationId: r.originatorConversationId, conversationId, resultCode: "0", resultDesc: "The service request is processed successfully.", receipt: receipt(), recipientName: name, amount: r.amount },
        ),
      this.delayMs,
    );
    return { conversationId, originatorConversationId: r.originatorConversationId };
  }

  /** Stops pending simulated callbacks (tests and shutdown). */
  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
