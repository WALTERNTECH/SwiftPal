"use client";

import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Drawer, Empty, PageHeader } from "@/components/dash/ui";
import { dateTime } from "@/lib/format";
import { useStore } from "@/lib/store";

type Log = { id: string; method: "POST" | "GET"; path: string; status: number; ms: number; at: string; req: object | null; res: object };

export default function Logs() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Log | null>(null);

  const logs = useMemo<Log[]>(() => {
    const out: Log[] = [];
    s.payments
      .filter((p) => p.mode === s.mode)
      .forEach((p, i) => {
        out.push({
          id: `req_${p.id.slice(4, 16)}`,
          method: "POST",
          path: "/v1/stk-push",
          status: 201,
          ms: 120 + ((i * 53) % 140),
          at: p.createdAt,
          req: { phone: p.phone, amount: p.amount, reference: p.reference },
          res: { id: p.id, object: "payment", status: "pending", amount: p.amount, fee: { amount: p.fee, charged: false } },
        });
        if (i % 6 === 2) {
          out.push({
            id: `req_${p.id.slice(4, 12)}G`,
            method: "GET",
            path: `/v1/stk-push/${p.id}`,
            status: 200,
            ms: 18 + (i % 20),
            at: new Date(new Date(p.createdAt).getTime() + 20_000).toISOString(),
            req: null,
            res: { id: p.id, object: "payment", status: p.status, mpesa_receipt: p.receipt },
          });
        }
      });
    s.payouts
      .filter((p) => p.mode === s.mode)
      .forEach((p, i) =>
        out.push({
          id: `req_${p.id.slice(3, 15)}`,
          method: "POST",
          path: p.batch ? "/v1/payouts/batches" : "/v1/payouts",
          status: 201,
          ms: 140 + ((i * 29) % 120),
          at: p.createdAt,
          req: { phone: p.phone, amount: p.amount, reference: p.reference, reason: p.reason },
          res: { id: p.id, object: "payout", status: "processing", fee: p.fee },
        }),
      );
    if (s.mode === "test") {
      out.push({
        id: "req_01JSAMPLE402",
        method: "POST",
        path: "/v1/stk-push",
        status: 402,
        ms: 41,
        at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        req: { phone: "254712345678", amount: 500, reference: "ORD-8790" },
        res: { error: { type: "balance_error", code: "insufficient_fee_credit", message: "Fee credit is KES 1.50 and this request needs KES 2.50 held." } },
      });
    }
    const needle = q.trim().toLowerCase();
    return out
      .sort((a, b) => b.at.localeCompare(a.at))
      .filter((l) => !needle || `${l.path} ${l.status} ${l.id}`.toLowerCase().includes(needle));
  }, [s.payments, s.payouts, s.mode, q]);

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
                {logs.slice(0, 80).map((l) => (
                  <tr key={l.id + l.at} className="clickable" onClick={() => setOpen(l)}>
                    <td><span className={`badge ${l.status < 300 ? "ok" : l.status < 500 ? "warn" : "bad"}`}>{l.status}</span></td>
                    <td><span className={`tag ${l.method === "GET" ? "get" : "post"}`}>{l.method}</span></td>
                    <td className="mono" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{l.path}</td>
                    <td className="right num muted">{l.ms} ms</td>
                    <td className="mono muted">{l.id}</td>
                    <td className="muted">{dateTime(l.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="logs" title="No requests yet" body="Calls made with your keys will appear here within a second." />
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
            {open.req && <CodeBlock tabs={[{ label: "Request body", lang: "json", code: JSON.stringify(open.req, null, 2) }]} />}
            <CodeBlock tabs={[{ label: `Response · ${open.status}`, lang: "json", code: JSON.stringify(open.res, null, 2) }]} />
          </>
        )}
      </Drawer>
    </>
  );
}
