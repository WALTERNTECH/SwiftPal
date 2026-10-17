"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { kes } from "@/components/dash/charts";
import { downloadCsv, Empty, PageHeader, PayBadge } from "@/components/dash/ui";
import { summarise, rangeStart } from "@/lib/analytics";
import { dateTime, fee, maskPhone, money } from "@/lib/format";
import { useStore, type PayStatus } from "@/lib/store";

type Filter = "all" | PayStatus | "unpaid";
const FILTERS: { v: Filter; t: string }[] = [
  { v: "all", t: "All" },
  { v: "succeeded", t: "Succeeded" },
  { v: "pending", t: "Pending" },
  { v: "unpaid", t: "Not paid" },
];
const PAGE = 15;

const initials = (phone: string) => phone.slice(-2);

export default function Payments() {
  const s = useStore();
  const { open, showPayment } = useActions();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const mine = useMemo(() => s.payments.filter((p) => p.mode === s.mode), [s.payments, s.mode]);
  const sum = useMemo(() => summarise(mine, [], rangeStart(30), Date.now() + 86_400_000), [mine]);
  const count = (f: Filter) =>
    f === "all" ? mine.length : f === "unpaid" ? mine.filter((p) => ["failed", "cancelled", "expired"].includes(p.status)).length : mine.filter((p) => p.status === f).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mine
      .filter((p) => (filter === "all" ? true : filter === "unpaid" ? ["failed", "cancelled", "expired"].includes(p.status) : p.status === filter))
      .filter((p) => !needle || [p.phone, p.reference, p.receipt ?? "", p.id].some((v) => v.toLowerCase().includes(needle)));
  }, [mine, filter, q]);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <>
      <PageHeader
        title="Payments"
        sub="STK Push collections"
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
              <Icon name="download" size={15} /> Export
            </button>
            <button className="btn btn-pine" onClick={() => open("payment")}>
              <Icon name="plus" size={15} /> {s.mode === "test" ? "Test payment" : "Request payment"}
            </button>
          </>
        }
      />

      <dl className="mini-stats rise">
        <div><dt>Collected · 30d</dt><dd>{kes(sum.collected)}</dd></div>
        <div><dt>Successful</dt><dd>{sum.paid}</dd></div>
        <div><dt>Success rate</dt><dd>{sum.rate === null ? "—" : `${(sum.rate * 100).toFixed(1)}%`}</dd></div>
        <div><dt>Average ticket</dt><dd>{sum.avgTicket ? kes(sum.avgTicket) : "—"}</dd></div>
      </dl>

      <section className="panel rise" style={{ ["--d" as string]: "60ms" }}>
        <div className="filters">
          <div className="pill-filter" role="group" aria-label="Status">
            {FILTERS.map((f) => (
              <button key={f.v} aria-pressed={filter === f.v} onClick={() => { setFilter(f.v); setPage(0); }}>
                {f.t} <em>{count(f.v)}</em>
              </button>
            ))}
          </div>
          <div className="search" style={{ marginLeft: "auto" }}>
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
                  {shown.map((p, i) => (
                    <tr key={p.id} className="clickable" onClick={() => showPayment(p.id)} style={{ animationDelay: `${i * 18}ms` }}>
                      <td className="right num" style={{ fontWeight: 500 }}>{money(p.amount)}</td>
                      <td><PayBadge s={p.status} /></td>
                      <td>
                        <span className="cust">
                          <span className="cust-av">{initials(p.phone)}</span>
                          <span className="mono">{maskPhone(p.phone)}</span>
                        </span>
                      </td>
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
            body={q || filter !== "all" ? "Try another filter." : s.mode === "live" ? "Live payments appear here." : "Send a test STK Push."}
            action={!q && filter === "all" ? <button className="btn btn-pine" onClick={() => open("payment")}>Send a test payment</button> : undefined}
          />
        )}
      </section>
    </>
  );
}
