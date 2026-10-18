"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Empty, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { KYC, money2, timeAgo } from "@/lib/format";

type Row = {
  id: string;
  name: string;
  type: string;
  account_code: string;
  verification_status: string;
  live_enabled: boolean;
  suspended_at: string | null;
  created_at: string;
  email: string;
  phone: string;
  fee_credit: number;
  payout_float: number;
  channels: number;
};

export default function Merchants() {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams();
  if (needle) params.set("q", needle);
  if (status) params.set("status", status);
  const { data, loading } = useApi<Row[]>(`/merchants?${params}`);

  return (
    <>
      <PageHeader title="Merchants" />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Name, email, phone or account code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search merchants" />
          </div>
          <select className="select input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>
            <option value="submitted">Under review</option>
            <option value="approved">Verified</option>
            <option value="not_started">Not started</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        {data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Merchant</th><th>Contact</th><th>Verification</th><th className="right">Fee credit</th><th className="right">Payout float</th><th className="right">Tills</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => (window.location.href = `/merchants/${m.id}`)}>
                    <td>
                      <Link href={`/merchants/${m.id}`} style={{ fontWeight: 500 }}>{m.name}</Link>
                      <div className="dim mono" style={{ fontSize: 11.5 }}>{m.account_code} · {m.type}</div>
                    </td>
                    <td>
                      <div>{m.email}</div>
                      <div className="dim mono" style={{ fontSize: 11.5 }}>{m.phone}</div>
                    </td>
                    <td>
                      {m.suspended_at ? <span className="badge bad">Suspended</span> : <span className={`badge ${KYC[m.verification_status]?.[0] ?? ""}`}>{KYC[m.verification_status]?.[1] ?? m.verification_status}</span>}
                    </td>
                    <td className="right num">{money2(m.fee_credit)}</td>
                    <td className="right num">{money2(m.payout_float)}</td>
                    <td className="right num">{m.channels}</td>
                    <td className="muted">{timeAgo(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="building" title={needle || status ? "No merchants match" : "No merchants yet"} body="" />
        )}
      </section>
    </>
  );
}
