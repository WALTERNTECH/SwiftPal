"use client";

import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { useApi, type AuditRow } from "@/lib/api";
import { actionLabel, dateTime } from "@/lib/format";

export default function Audit() {
  const { data, loading } = useApi<AuditRow[]>("/audit", { refreshMs: 30_000 });
  return (
    <>
      <PageHeader title="Audit log" sub="Every admin action, newest first" />
      <section className="panel">
        {data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Merchant</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="muted">{dateTime(a.created_at)}</td>
                    <td>{a.admin_name ?? "System"}</td>
                    <td>{actionLabel(a.action)}</td>
                    <td>{a.target_type === "merchant" && a.target_id ? <Link href={`/merchants/${a.target_id}`} className="mono">{a.target_id.slice(0, 16)}</Link> : <span className="dim">—</span>}</td>
                    <td className="json">{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : ""}</td>
                    <td className="mono muted">{a.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="logs" title="Nothing recorded yet" body="" />
        )}
      </section>
    </>
  );
}
