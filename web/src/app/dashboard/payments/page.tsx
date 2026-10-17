"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { kes } from "@/components/dash/charts";
import { downloadCsv, Empty, PageHeader, PayBadge, useToast } from "@/components/dash/ui";
import { api, useApi, useMode, usePaged, type Analytics, type Payment } from "@/lib/api";
import { dateTime, fee, maskPhone, money } from "@/lib/format";

type Filter = "all" | "succeeded" | "pending" | "unpaid";
const FILTERS: { v: Filter; t: string }[] = [
  { v: "all", t: "All" },
  { v: "succeeded", t: "Succeeded" },
  { v: "pending", t: "Pending" },
  { v: "unpaid", t: "Not paid" },
];
const PAGE = 15;

const initials = (phone: string) => phone.slice(-2);

export default function Payments() {
  const mode = useMode();
  const toast = useToast();
  const { open, showPayment } = useActions();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ mode });
  if (filter !== "all") params.set("status", filter);
  if (needle) params.set("q", needle);
  const { data: counts } = useApi<Record<Filter, number>>(`/app/payments/counts?mode=${mode}`);
  const { data: month } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=30`);
  const list = usePaged<Payment>(`/app/payments?${params}`, PAGE, (counts?.pending ?? 0) > 0 ? 3000 : 15_000);
  const sum = month?.current;
  const shown = list.rows;
  const from = list.page * PAGE;

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await api<Payment[]>(`/app/payments?${params}&limit=200`);
      downloadCsv(`swiftpal-payments-${mode}.csv`, [
        ["id", "created_at", "status", "amount", "phone", "reference", "mpesa_receipt", "fee_charged", "channel"],
        ...all.map((p) => [p.id, p.created_at, p.status, p.amount, p.phone, p.reference, p.mpesa_receipt, p.fee.charged ? p.fee.amount : 0, p.channel]),
      ]);
      if (all.length === 200) toast("Exported the latest 200 payments");
    } catch (err) {
      toast((err as Error).message, "alert");
    }
    setExporting(false);
  }

  return (
    <>
      <PageHeader
        title="Payments"
        sub="STK Push collections"
        actions={
          <>
            <button className="btn btn-line" disabled={!shown.length || exporting} onClick={exportCsv}>
              {exporting ? <span className="spinner" /> : <Icon name="download" size={15} />} Export
            </button>
            <button className="btn btn-pine" onClick={() => open("payment")}>
              <Icon name="plus" size={15} /> {mode === "test" ? "Test payment" : "Request payment"}
            </button>
          </>
        }
      />

      <dl className="mini-stats rise">
        <div><dt>Collected · 30d</dt><dd>{sum ? kes(sum.collected) : "—"}</dd></div>
        <div><dt>Successful</dt><dd>{sum ? sum.successful : "—"}</dd></div>
        <div><dt>Success rate</dt><dd>{!sum || sum.success_rate === null ? "—" : `${(sum.success_rate * 100).toFixed(1)}%`}</dd></div>
        <div><dt>Average ticket</dt><dd>{sum?.average_ticket ? kes(sum.average_ticket) : "—"}</dd></div>
      </dl>

      <section className="panel rise" style={{ ["--d" as string]: "60ms" }}>
        <div className="filters">
          <div className="pill-filter" role="group" aria-label="Status">
            {FILTERS.map((f) => (
              <button key={f.v} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>
                {f.t} <em>{counts ? counts[f.v] : ""}</em>
              </button>
            ))}
          </div>
          <div className="search" style={{ marginLeft: "auto" }}>
            <Icon name="search" size={15} />
            <input className="input" placeholder="Phone, reference or receipt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
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
                      <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                      <td className="right num">{p.fee.charged ? fee(p.fee.amount) : <span className="dim">0</span>}</td>
                      <td className="muted">{dateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>
                {from + 1}–{from + shown.length}
                {!needle && counts ? ` of ${counts[filter]}` : ""}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-line btn-sm" disabled={list.page === 0} onClick={list.prev}>Previous</button>
                <button className="btn btn-line btn-sm" disabled={!list.hasNext} onClick={list.next}>Next</button>
              </div>
            </div>
          </>
        ) : list.loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty
            icon="collect"
            title={needle || filter !== "all" ? "No payments match" : "No payments yet"}
            body={list.error ? list.error.message : needle || filter !== "all" ? "Try another filter." : mode === "live" ? "Live payments appear here." : "Send a test STK Push."}
            action={!needle && filter === "all" ? <button className="btn btn-pine" onClick={() => open("payment")}>{mode === "test" ? "Send a test payment" : "Request a payment"}</button> : undefined}
          />
        )}
      </section>
    </>
  );
}
