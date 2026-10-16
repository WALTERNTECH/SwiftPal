// A drawn handset showing the M-Pesa SIM toolkit prompt. Pure presentation:
// the parent decides which stage to show.

export type PromptStage = "idle" | "prompt" | "pin" | "processing" | "done" | "cancelled";

export function PhonePrompt({
  stage,
  amount,
  merchant,
  account,
  pinDigits = 0,
  receipt,
}: {
  stage: PromptStage;
  amount: string;
  merchant: string;
  account?: string;
  pinDigits?: number;
  receipt?: string;
}) {
  return (
    <div className="phone" aria-label="Customer phone">
      <div className="phone-notch" />
      <div className="phone-status">
        <span>9:41</span>
        <span className="phone-bars" aria-hidden>
          <i /> <i /> <i /> <i />
        </span>
      </div>
      <div className="phone-screen">
        {stage === "idle" && (
          <div className="phone-idle">
            <div className="phone-clock">9:41</div>
            <div className="phone-date">Friday, 16 October</div>
          </div>
        )}
        {(stage === "prompt" || stage === "pin") && (
          <div className="sim-dialog">
            <div className="sim-title">M-PESA</div>
            <p>
              Pay <b>{amount}</b> to <b>{merchant}</b>
              {account ? (
                <>
                  {" "}
                  Acc. <b>{account}</b>
                </>
              ) : null}
              .
            </p>
            <p>Enter M-PESA PIN:</p>
            <div className="sim-input">{"•".repeat(pinDigits)}<span className="caret" /></div>
            <div className="sim-actions">
              <span>Cancel</span>
              <span className={pinDigits >= 4 ? "on" : ""}>OK</span>
            </div>
          </div>
        )}
        {stage === "processing" && (
          <div className="sim-dialog center">
            <div className="spinner" />
            <p>Processing…</p>
          </div>
        )}
        {stage === "done" && (
          <div className="sms">
            <div className="sms-from">MPESA</div>
            <p>
              <b>{receipt}</b> Confirmed. {amount} paid to {merchant}
              {account ? ` for account ${account}` : ""} on 16/10/26 at 9:41 AM.
            </p>
          </div>
        )}
        {stage === "cancelled" && (
          <div className="sim-dialog center">
            <p>Request cancelled by user.</p>
          </div>
        )}
      </div>
    </div>
  );
}
