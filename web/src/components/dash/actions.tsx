"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ChannelModal } from "./ChannelModal";
import { KeyModal } from "./KeyModal";
import { NewPaymentModal, PaymentDrawer, PayoutModal, TopUpModal, WithdrawModal } from "./modals";

export type Action = "payment" | "payout" | "topup-fee" | "topup-float" | "withdraw" | "channel" | "key";

type Ctx = { open: (a: Action) => void; showPayment: (id: string) => void };
const ActionsCtx = createContext<Ctx>({ open: () => {}, showPayment: () => {} });

/** Lets any page, the "New" menu or the command palette open the same modals. */
export const useActions = () => useContext(ActionsCtx);

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<Action | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const close = useCallback(() => setAction(null), []);
  const open = useCallback((a: Action) => setAction(a), []);
  const showPayment = useCallback((id: string) => setPaymentId(id), []);

  return (
    <ActionsCtx.Provider value={{ open, showPayment }}>
      {children}
      <NewPaymentModal open={action === "payment"} onClose={close} onCreated={setPaymentId} />
      <PayoutModal open={action === "payout"} onClose={close} />
      <TopUpModal open={action === "topup-fee" || action === "topup-float"} initial={action === "topup-float" ? "float" : "fee"} onClose={close} />
      <WithdrawModal open={action === "withdraw"} onClose={close} />
      <ChannelModal open={action === "channel"} onClose={close} />
      <KeyModal open={action === "key"} onClose={close} />
      <PaymentDrawer id={paymentId} onClose={() => setPaymentId(null)} />
    </ActionsCtx.Provider>
  );
}
