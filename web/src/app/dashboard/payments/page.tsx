"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { NewPaymentModal, PaymentDrawer } from "@/components/dash/modals";
import { downloadCsv, Empty, PageHeader, PayBadge } from "@/components/dash/ui";
import { dateTime, fee, maskPhone, money } from "@/lib/format";
import { useStore, type PayStatus } from "@/lib/store";

const FILTERS: { v: "all" | PayStatus | "unpaid"; t: string }[] = [
  { v: "all", t: "All" },
  { v: "succeeded", t: "Succeeded" },
  { v: "pending", t: "Pending" },
  { v: "unpaid", t: "Not paid" },
];

const PAGE = 15;

export default function Payments() {
  const s = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["v"]>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newPay, setNewPay] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.payments
      .filter((p) => p.mode === s.mode)
      .filter((p) =>
        filter === "all" ? true : filter === "unpaid" ? ["failed", "cancelled", "expired"].includes(p.status) : p.status === filter,
      )
      .filter((p) => !needle || [p.phone, p.reference, p.receipt ?? "", p.id].some((v) => v.toLowerCase().includes(needle)));
  }, [s.payments, s.mode, filter, q]);

  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <>
      <PageHeader
        title="Payments"
        sub="STK Push collections."
        actions={
          <>
            <button
              className="btn btn-line"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(`swiftpal-payments-${s.mode}.csv`, [
                  ["id", "created_at", "status", "amount", "phone", "reference", "mpesa_receipt", "fee_charged", "channel"],
                  ...rows.map((p) => [p.id, p.createdAt, p.status, p.amount, p.phone, p.reference, p.receipt, p.feeCharged ? p.fee : 0, p.channel]),
                ])
              }
            >
              <Icon name="download" size={15} /> Export CSV
            </button>
            <button className="btn btn-ink" onClick={() => setNewPay(true)}>
              <Icon name="plus" size={15} /> {s.mode === "test" ? "Test payment" : "Request payment"}
            </button>
          </>
        }
      />

      <section className="panel">
        <div className="filters">
          <div className="segmented" role="group" aria-label="Status">
            {FILTERS.map((f) => (
              <button key={f.v} aria-pressed={filter === f.v} onClick={() => { setFilter(f.v); setPage(0); }}>
                {f.t}
              </button>
            ))}
          </div>
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Phone, reference or receipt" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search payments" />
          </div>
        </div>
        {shown.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="right">Amount</th>
                    <th>Status</th>
                    <th>Customer</th>
                    <th>Reference</th>
                    <th>M-Pesa receipt</th>
                    <th className="right">Fee</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setOpenId(p.id)}>
                      <td className="right num">{money(p.amount)}</td>
                      <td><PayBadge s={p.status} /></td>
                      <td className="mono">{maskPhone(p.phone)}</td>
                      <td className="mono">{p.reference}</td>
                      <td className="mono">{p.receipt ?? <span className="dim">—</span>}</td>
                      <td className="right num">{p.feeCharged ? fee(p.fee) : <span className="dim">0</span>}</td>
                      <td className="muted">{dateTime(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>
                {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-line btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn btn-line btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            icon="collect"
            title={q || filter !== "all" ? "No payments match" : "No payments yet"}
            body={q || filter !== "all" ? "Try a different filter or search." : s.mode === "live" ? "Live payments appear here once customers pay through your verified channel." : "Send a test STK Push to see how payments flow."}
            action={!q && filter === "all" ? <button className="btn btn-ink" onClick={() => setNewPay(true)}>Send a test payment</button> : undefined}
          />
        )}
      </section>

      <NewPaymentModal open={newPay} onClose={() => setNewPay(false)} onCreated={setOpenId} />
      <PaymentDrawer payment={s.payments.find((p) => p.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </>
  );
}
