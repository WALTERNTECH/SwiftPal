"use client";

import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Drawer, Empty, PageHeader } from "@/components/dash/ui";
import { useApi, useMode, type LogRow } from "@/lib/api";
import { dateTime } from "@/lib/format";

export default function Logs() {
  const mode = useMode();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LogRow | null>(null);
  const { data, loading, error } = useApi<LogRow[]>(`/app/logs?mode=${mode}`, { refreshMs: 10_000 });

  const logs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((l) => !needle || `${l.method} ${l.path} ${l.status} ${l.id}`.toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <>
      <PageHeader title="Request logs" sub="Every API call made with your keys, with the full request and response. Kept for 30 days." />
      <section className="panel">
        <div className="filters">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Path, status or request ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search logs" />
          </div>
        </div>
        {logs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Status</th><th>Method</th><th>Path</th><th className="right">Duration</th><th>Request ID</th><th>Time</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="clickable" onClick={() => setOpen(l)}>
                    <td><span className={`badge ${l.status < 300 ? "ok" : l.status < 500 ? "warn" : "bad"}`}>{l.status}</span></td>
                    <td><span className={`tag ${l.method === "GET" ? "get" : "post"}`}>{l.method}</span></td>
                    <td className="mono" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{l.path}</td>
                    <td className="right num muted">{l.duration_ms} ms</td>
                    <td className="mono muted">{l.id}</td>
                    <td className="muted">{dateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty
            icon="logs"
            title={q ? "No requests match" : "No requests yet"}
            body={error ? error.message : q ? "Try another search." : `Calls made with your ${mode} keys appear here within a second.`}
          />
        )}
      </section>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open && (
          <div className="row">
            <span className={`tag ${open.method === "GET" ? "get" : "post"}`}>{open.method}</span>
            <span className="mono" style={{ fontSize: 13.5 }}>{open.path}</span>
          </div>
        )}
      >
        {open && (
          <>
            {open.request_body != null && <CodeBlock tabs={[{ label: "Request body", lang: "json", code: JSON.stringify(open.request_body, null, 2) }]} />}
            <CodeBlock tabs={[{ label: `Response · ${open.status}`, lang: "json", code: JSON.stringify(open.response_body, null, 2) }]} />
          </>
        )}
      </Drawer>
    </>
  );
}
