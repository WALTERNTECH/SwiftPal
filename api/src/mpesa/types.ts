export type StkRequest = {
  /** Shortcode that owns the M-Pesa Express product and the passkey. */
  businessShortCode: string;
  passkey: string;
  /** Where the money lands: the till or paybill number. */
  partyB: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  amount: number;
  phone: string;
  accountReference: string;
  description: string;
  callbackUrl: string;
};

export type B2cRequest = {
  originatorConversationId: string;
  amount: number;
  phone: string;
  commandId: "BusinessPayment" | "SalaryPayment" | "PromotionPayment";
  remarks: string;
  occasion: string;
  resultUrl: string;
  timeoutUrl: string;
};

/** A finished STK prompt, normalised from Safaricom's callback. */
export type StkResult = {
  checkoutRequestId: string;
  merchantRequestId?: string;
  resultCode: string;
  resultDesc: string;
  receipt?: string;
  amount?: number;
  phone?: string;
};

/** A finished B2C request, normalised from Safaricom's result callback. */
export type B2cResult = {
  originatorConversationId: string;
  conversationId?: string;
  resultCode: string;
  resultDesc: string;
  receipt?: string;
  recipientName?: string;
  amount?: number;
};

export interface MpesaDriver {
  readonly name: "sandbox" | "daraja";
  stkPush(r: StkRequest): Promise<{ merchantRequestId: string; checkoutRequestId: string }>;
  /** resultCode null means M-Pesa is still processing. */
  stkQuery(r: { businessShortCode: string; passkey: string; checkoutRequestId: string }): Promise<{ resultCode: string | null; resultDesc: string }>;
  b2c(r: B2cRequest): Promise<{ conversationId: string; originatorConversationId: string }>;
}

/** Thrown when Safaricom rejects a request outright (as opposed to a later failed callback). */
export class MpesaRejected extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
