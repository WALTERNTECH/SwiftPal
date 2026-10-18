"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { ResolveModal } from "@/components/money";
import { Empty, PageHeader } from "@/components/ui";
import { useApi, type Payout } from "@/lib/api";
import { dateTime, money } from "@/lib/format";

export default function Payouts() {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [status, setStatus] = useState("");
  const [stuck, setStuck] = useState(false);
  const [resolving, setResolving] = useState<Payout | null>(null);

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
  if (stuck) params.set("stuck", "1");
  const { data, loading } = useApi<Payout[]>(`/payouts?${params}`, { refreshMs: 20_000 });

  return (
    <>
      <PageHeader title="Payouts" sub="Live B2C payouts and withdrawals, every merchant" />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Receipt, reference, phone, id or merchant" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <select className="select input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="succeeded">Delivered</option>
            <option value="failed">Failed</option>
            <option value="reversed">Reversed</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={stuck} onChange={(e) => setStuck(e.target.checked)} />
            <span>Stuck only</span>
          </label>
        </div>
        {data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th className="right">Amount</th><th>Merchant</th><th>Type</th><th>Status</th><th>Recipient</th><th>Reference</th><th>Receipt</th><th>Date</th><th /></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} title={p.failure_message ?? undefined}>
                    <td className="right num">{money(p.amount)}</td>
                    <td><Link href={`/merchants/${p.merchant_id}`}>{p.merchant_name}</Link></td>
                    <td className="muted">{p.purpose === "withdrawal" ? "Withdrawal" : "Payout"}</td>
                    <td><span className={`badge ${p.status === "succeeded" ? "ok" : p.status === "processing" ? "info" : "bad"}`}>{p.raw_status === "queued" ? "queued" : p.status}</span></td>
                    <td>
                      <div>{p.recipient_name ?? <span className="dim">—</span>}</div>
                      <div className="dim mono" style={{ fontSize: 11.5 }}>{p.phone}</div>
                    </td>
                    <td className="mono">{p.reference}</td>
                    <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                    <td className="muted">{dateTime(p.created_at)}</td>
                    <td className="right">{(p.raw_status === "queued" || p.raw_status === "processing") && <button className="btn btn-line btn-sm" onClick={() => setResolving(p)}>Resolve</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="payout" title="No payouts match" body="" />
        )}
      </section>
      <ResolveModal kind="payout" item={resolving} onClose={() => setResolving(null)} />
    </>
  );
}
