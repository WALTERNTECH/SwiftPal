"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";

type Row = { id: string; merchant_id: string; kind: string; name: string; status: string; submitted_at: string; reviewed_at: string | null; merchant_name: string; email: string };

const TABS = [
  { v: "submitted", t: "Under review" },
  { v: "approved", t: "Approved" },
  { v: "rejected", t: "Rejected" },
];

export default function Verifications() {
  const [status, setStatus] = useState("submitted");
  const { data, loading } = useApi<Row[]>(`/verifications?status=${status}`, { refreshMs: 30_000 });

  return (
    <>
      <PageHeader title="Verifications" />
      <section className="panel">
        <div className="toolbar">
          <div className="seg-tabs" role="group" aria-label="Status">
            {TABS.map((t) => (
              <button key={t.v} aria-current={status === t.v} onClick={() => setStatus(t.v)}>
                {t.t}
              </button>
            ))}
          </div>
        </div>
        {data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Merchant</th><th>Type</th><th>Name on ID</th><th>Email</th><th>Submitted</th><th /></tr>
              </thead>
              <tbody>
                {data.map((v) => (
                  <tr key={v.id}>
                    <td><b style={{ fontWeight: 500 }}>{v.merchant_name}</b></td>
                    <td style={{ textTransform: "capitalize" }}>{v.kind}</td>
                    <td>{v.name}</td>
                    <td className="muted">{v.email}</td>
                    <td className="muted" title={dateTime(v.submitted_at)}>{timeAgo(v.submitted_at)}</td>
                    <td className="right">
                      <Link href={`/verifications/${v.id}`} className={`btn btn-sm ${status === "submitted" ? "btn-pine" : "btn-line"}`}>
                        {status === "submitted" ? "Review" : "Open"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="shield" title={status === "submitted" ? "Nothing to review" : "None yet"} body={status === "submitted" ? "New submissions appear here." : ""} />
        )}
      </section>
    </>
  );
}
