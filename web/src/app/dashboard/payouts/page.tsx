"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { PayoutModal } from "@/components/dash/modals";
import { downloadCsv, Empty, Modal, PageHeader, PayoutBadge, useToast } from "@/components/dash/ui";
import { dateTime, maskPhone, money, normalisePhone } from "@/lib/format";
import { b2cFee } from "@/lib/pricing";
import { newId, simulatePayout, useStore } from "@/lib/store";

export default function Payouts() {
  const s = useStore();
  const [single, setSingle] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const blocked = s.mode === "live" && s.verification !== "approved";

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.payouts
      .filter((p) => p.mode === s.mode)
      .filter((p) => !needle || [p.phone, p.reference, p.receipt ?? "", p.recipient ?? ""].some((v) => v.toLowerCase().includes(needle)));
  }, [s.payouts, s.mode, q]);

  return (
    <>
      <PageHeader
        title="Payouts"
        sub="B2C disbursements from your payout float to any Safaricom number."
        actions={
          <>
            <button className="btn btn-line" disabled={blocked} onClick={() => setBulk(true)}>
              <Icon name="upload" size={15} /> Bulk upload
            </button>
            <button className="btn btn-ink" disabled={blocked} onClick={() => setSingle(true)}>
              <Icon name="plus" size={15} /> Send payout
            </button>
          </>
        }
      />

      {blocked && (
        <div className="callout warn">
          <Icon name="shield" size={16} />
          <span className="grow">
            <b>Live payouts are off until your business details are approved.</b> Payouts move money we hold for you, so we have to know
            who you are. It usually takes a few hours.
          </span>
          <Link href="/dashboard/settings?tab=verification" className="btn btn-line btn-sm">
            {s.verification === "submitted" ? "View status" : "Submit details"}
          </Link>
        </div>
      )}

      <section className="panel">
        <div className="filters">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Phone, name, reference or receipt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payouts" />
          </div>
          <div className="grow" />
          <button
            className="btn btn-ghost btn-sm"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(`swiftpal-payouts-${s.mode}.csv`, [
                ["id", "created_at", "status", "amount", "fee", "phone", "recipient", "reference", "reason", "mpesa_receipt", "batch"],
                ...rows.map((p) => [p.id, p.createdAt, p.status, p.amount, p.fee, p.phone, p.recipient, p.reference, p.reason, p.receipt, p.batch]),
              ])
            }
          >
            <Icon name="download" size={14} /> Export
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="right">Amount</th>
                  <th>Status</th>
                  <th>Recipient</th>
                  <th>Reference</th>
                  <th>Reason</th>
                  <th>Receipt</th>
                  <th className="right">Fee</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((p) => (
                  <tr key={p.id}>
                    <td className="right num">{money(p.amount)}</td>
                    <td><PayoutBadge s={p.status} /></td>
                    <td>
                      <div>{p.recipient ?? <span className="dim">—</span>}</div>
                      <div className="dim mono" style={{ fontSize: 12 }}>{maskPhone(p.phone)}</div>
                    </td>
                    <td className="mono">
                      {p.reference}
                      {p.batch && <div className="dim" style={{ fontSize: 11.5 }}>{p.batch.slice(0, 16)}</div>}
                    </td>
                    <td className="muted">{p.reason}</td>
                    <td className="mono">{p.receipt ?? <span className="dim">—</span>}</td>
                    <td className="right num">{p.status === "failed" ? <s className="dim">{p.fee}</s> : p.fee}</td>
                    <td className="muted">{dateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="payout"
            title={q ? "No payouts match" : "No payouts yet"}
            body={q ? "Try a different search." : "Send a single payout or upload a CSV to pay many people at once."}
          />
        )}
      </section>

      <PayoutModal open={single} onClose={() => setSingle(false)} />
      <BulkModal open={bulk} onClose={() => setBulk(false)} />
    </>
  );
}

type Row = { line: number; phone: string | null; raw: string; amount: number; reference: string; reason: string; error?: string; fee: number };

const SAMPLE = "phone,amount,reference,reason\n0712345678,18500,EMP-014,salary\n0722000104,21000,EMP-015,salary\n0700000002,1500,EMP-016,salary";

function parse(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const start = /phone/i.test(lines[0]) ? 1 : 0;
  return lines.slice(start).map((l, i) => {
    const [ph = "", am = "", ref = "", reason = "other"] = l.split(",").map((c) => c.trim());
    const phone = normalisePhone(ph);
    const amount = Math.floor(Number(am));
    const f = b2cFee(amount);
    let error: string | undefined;
    if (!phone) error = "Invalid phone";
    else if (!amount || f === null) error = "Amount must be 10–250,000";
    return { line: i + start + 1, phone, raw: ph, amount: amount || 0, reference: ref || `ROW-${i + 1}`, reason, error, fee: f ?? 0 };
  });
}

function BulkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const bal = s.balances[s.mode];
  const valid = rows.filter((r) => !r.error);
  const total = valid.reduce((a, r) => a + r.amount, 0);
  const fees = valid.reduce((a, r) => a + r.fee, 0);

  async function load(file: File) {
    setName(file.name);
    setRows(parse(await file.text()));
    setError("");
  }

  function reset() {
    setRows([]);
    setName("");
    setError("");
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Bulk payout"
      width={640}
      footer={
        rows.length ? (
          <>
            <button className="btn btn-line" onClick={reset}>Choose another file</button>
            <button
              className="btn btn-ink"
              disabled={!valid.length}
              onClick={() => {
                if (total > bal.float) return setError(`Float is ${money(bal.float)} and this batch needs ${money(total)}. Nothing was sent.`);
                if (fees > bal.fee && !s.autoCover) return setError(`Fee credit is ${money(bal.fee)} and this batch needs ${money(fees)}. Nothing was sent.`);
                const batch = newId("bat");
                valid.forEach((r) => simulatePayout({ phone: r.phone!, amount: r.amount, reference: r.reference, reason: r.reason, batch }));
                toast(`${valid.length} payouts queued · ${money(total)}`);
                reset();
                onClose();
              }}
            >
              Pay {valid.length} recipients · {money(total)}
            </button>
          </>
        ) : undefined
      }
    >
      {!rows.length ? (
        <>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
            role="button"
            tabIndex={0}
          >
            <Icon name="upload" size={20} />
            <b style={{ color: "var(--ink)" }}>Drop a CSV here or click to choose</b>
            <span>Columns: phone, amount, reference, reason. Up to 1,000 rows.</span>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </div>
          <div className="spread">
            <span className="hint">The whole batch is checked against your float before anything is sent.</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setName("sample.csv"); setRows(parse(SAMPLE)); }}>
              Use sample file
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="spread">
            <span className="mono" style={{ fontSize: 13 }}>{name}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {valid.length} valid · {rows.length - valid.length} with errors
            </span>
          </div>
          <div className="panel table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Row</th><th>Phone</th><th className="right">Amount</th><th>Reference</th><th className="right">Fee</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line}>
                    <td className="dim num">{r.line}</td>
                    <td className="mono">{r.phone ?? r.raw}</td>
                    <td className="right num">{money(r.amount)}</td>
                    <td className="mono">{r.reference}</td>
                    <td className="right num">{r.error ? "—" : r.fee}</td>
                    <td>{r.error ? <span className="badge bad">{r.error}</span> : <span className="badge ok">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="kpi"><dt>Total to pay</dt><dd style={{ fontSize: 18 }}>{money(total)}</dd><span className="sub">from float {money(bal.float)}</span></div>
            <div className="kpi"><dt>Fees</dt><dd style={{ fontSize: 18 }}>{money(fees)}</dd><span className="sub">from fee credit</span></div>
            <div className="kpi"><dt>Recipients</dt><dd style={{ fontSize: 18 }}>{valid.length}</dd><span className="sub">rows with errors are skipped</span></div>
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      )}
    </Modal>
  );
}
