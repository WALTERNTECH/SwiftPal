"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { ResolveModal } from "@/components/money";
import { Empty, PageHeader } from "@/components/ui";
import { useApi, type Payment } from "@/lib/api";
import { dateTime, money } from "@/lib/format";

export default function Payments() {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState("");
  const [stuck, setStuck] = useState(false);
  const [resolving, setResolving] = useState<Payment | null>(null);

  useEffect(() => {
    setStuck(new URLSearchParams(window.location.search).get("stuck") === "1");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (needle) params.set("q", needle);
  if (status) params.set("status", status);
  if (purpose) params.set("purpose", purpose);
  if (stuck) params.set("stuck", "1");
  const { data, loading } = useApi<Payment[]>(`/payments?${params}`, { refreshMs: 20_000 });

  return (
    <>
      <PageHeader title="Payments" sub="Live STK Push payments and wallet top-ups, every merchant" />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Receipt, reference, phone, id or merchant" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <select className="select input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
          <select className="select input" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Type">
            <option value="">Payments and top-ups</option>
            <option value="charge">Payments</option>
            <option value="topup">Top-ups</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={stuck} onChange={(e) => setStuck(e.target.checked)} />
            <span>Stuck only</span>
          </label>
        </div>
        {data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th className="right">Amount</th><th>Merchant</th><th>Type</th><th>Status</th><th>Phone</th><th>Reference</th><th>Receipt</th><th>Date</th><th /></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} title={p.failure_message ?? undefined}>
                    <td className="right num">{money(p.amount)}</td>
                    <td><Link href={`/merchants/${p.merchant_id}`}>{p.merchant_name}</Link></td>
                    <td className="muted">{p.purpose === "topup" ? "Top-up" : "Payment"}</td>
                    <td><span className={`badge ${p.status === "succeeded" ? "ok" : p.status === "pending" ? "info" : "warn"}`}>{p.status}</span></td>
                    <td className="mono">{p.phone}</td>
                    <td className="mono">{p.reference}</td>
                    <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                    <td className="muted">{dateTime(p.created_at)}</td>
                    <td className="right">{p.status !== "succeeded" && <button className="btn btn-line btn-sm" onClick={() => setResolving(p)}>Resolve</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="collect" title="No payments match" body="" />
        )}
      </section>
      <ResolveModal kind="payment" item={resolving} onClose={() => setResolving(null)} />
    </>
  );
}
