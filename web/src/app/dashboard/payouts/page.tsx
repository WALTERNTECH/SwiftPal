"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { kes } from "@/components/dash/charts";
import { downloadCsv, Empty, Modal, PageHeader, PayoutBadge, useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, useApi, useMode, usePaged, type ApiError, type Payout } from "@/lib/api";
import { dateTime, maskPhone, money, normalisePhone } from "@/lib/format";
import { b2cFee } from "@/lib/pricing";
import { SmsConfirm } from "@/components/dash/SmsConfirm";

const PAGE = 20;
const REASONS = ["salary", "withdrawal", "refund", "commission", "promotion", "other"];

export default function Payouts() {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const { open } = useActions();
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [watching, setWatching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const vs = me.merchant.verification_status;
  const blocked = mode === "live" && vs !== "approved";

  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ mode });
  if (needle) params.set("q", needle);
  const { data: summary } = useApi<{ sent: number; paid_out: number; failed: number }>(`/app/payouts/summary?mode=${mode}`);
  const list = usePaged<Payout>(`/app/payouts?${params}`, PAGE, watching ? 3000 : 20_000);
  const rows = list.rows;

  // Poll quickly while anything is in flight, and refresh balances when it lands.
  const processing = rows.filter((p) => p.status === "processing").length;
  const was = useRef(0);
  useEffect(() => {
    setWatching(processing > 0);
    if (processing < was.current) invalidate("/app/me", "/app/payouts/summary", "/app/wallet", "/app/ledger", "/app/analytics");
    was.current = processing;
  }, [processing]);

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await api<Payout[]>(`/app/payouts?${params}&limit=200`);
      downloadCsv(`swiftpal-payouts-${mode}.csv`, [
        ["id", "created_at", "status", "amount", "fee", "phone", "recipient", "reference", "reason", "mpesa_receipt", "batch"],
        ...all.map((p) => [p.id, p.created_at, p.status, p.amount, p.fee.amount, p.phone, p.recipient_name, p.reference, p.reason, p.mpesa_receipt, p.batch]),
      ]);
      if (all.length === 200) toast("Exported the latest 200 payouts");
    } catch (err) {
      toast((err as Error).message, "alert");
    }
    setExporting(false);
  }

  return (
    <>
      <PageHeader
        title="Payouts"
        sub="B2C disbursements"
        actions={
          <>
            <button className="btn btn-line" disabled={blocked} onClick={() => setBulk(true)}>
              <Icon name="upload" size={15} /> Bulk upload
            </button>
            <button className="btn btn-pine" disabled={blocked} onClick={() => open("payout")}>
              <Icon name="plus" size={15} /> Send payout
            </button>
          </>
        }
      />

      {blocked && (
        <div className="callout warn rise">
          <Icon name="idcard" size={16} />
          <span className="grow">
            <b>{vs === "submitted" ? "Verification in review." : "Live payouts need a verified account."}</b>
          </span>
          <Link href="/dashboard/verification" className="btn btn-line btn-sm">
            {vs === "submitted" ? "View status" : "Verify now"}
          </Link>
        </div>
      )}

      <dl className="mini-stats rise">
        <div><dt>Float available</dt><dd>{kes(me.balances[mode].payout_float.available)}</dd></div>
        <div><dt>Sent</dt><dd>{summary ? summary.sent : "—"}</dd></div>
        <div><dt>Total paid out</dt><dd>{summary ? kes(summary.paid_out) : "—"}</dd></div>
        <div><dt>Failed · refunded</dt><dd>{summary ? summary.failed : "—"}</dd></div>
      </dl>

      <section className="panel rise" style={{ ["--d" as string]: "60ms" }}>
        <div className="filters">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Phone, name, reference or receipt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payouts" />
          </div>
          <div className="grow" />
          <button className="btn btn-ghost btn-sm" disabled={!rows.length || exporting} onClick={exportCsv}>
            {exporting ? <span className="spinner" /> : <Icon name="download" size={14} />} Export
          </button>
        </div>
        {rows.length ? (
          <>
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
                  {rows.map((p) => (
                    <tr key={p.id} title={p.failure_message ?? undefined}>
                      <td className="right num">{money(p.amount)}</td>
                      <td><PayoutBadge s={p.status} /></td>
                      <td>
                        <div>{p.recipient_name ?? <span className="dim">—</span>}</div>
                        <div className="dim mono" style={{ fontSize: 12 }}>{maskPhone(p.phone)}</div>
                      </td>
                      <td className="mono">
                        {p.reference}
                        {p.batch && <div className="dim" style={{ fontSize: 11.5 }}>{p.batch.slice(0, 16)}</div>}
                      </td>
                      <td className="muted">{p.reason}</td>
                      <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                      <td className="right num">{p.fee.refunded ? <s className="dim">{p.fee.amount}</s> : p.fee.amount}</td>
                      <td className="muted">{dateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>
                {list.page * PAGE + 1}–{list.page * PAGE + rows.length}
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
            icon="payout"
            title={needle ? "No payouts match" : "No payouts yet"}
            body={list.error ? list.error.message : needle ? "Try a different search." : "Send a single payout or upload a CSV to pay many people at once."}
          />
        )}
      </section>

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
    const [ph = "", am = "", ref = "", rs = ""] = l.split(",").map((c) => c.trim());
    const phone = normalisePhone(ph);
    const amount = Math.floor(Number(am));
    const f = b2cFee(amount);
    const reason = rs.toLowerCase() || "other";
    let error: string | undefined;
    if (!phone) error = "Invalid phone";
    else if (!amount || f === null) error = "Amount must be 10–250,000";
    else if (!REASONS.includes(reason)) error = "Unknown reason";
    return { line: i + start + 1, phone, raw: ph, amount: amount || 0, reference: (ref || `ROW-${i + 1}`).slice(0, 32), reason, error, fee: f ?? 0 };
  });
}

function BulkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const bal = me.balances[mode];
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
    setHint(null);
  }

  const items = valid.map((r) => ({ phone: r.phone!, amount: r.amount, reference: r.reference, reason: r.reason }));

  async function send(code?: string) {
    await api("/app/payouts/batches", { body: { mode, reference: name.replace(/\.csv$/i, "").slice(0, 40) || undefined, items, code } });
    invalidate("/app/payouts", "/app/me", "/app/wallet", "/app/ledger");
    toast(`${valid.length} payouts queued · ${money(total)}`);
    reset();
    onClose();
  }

  /** Live batches are confirmed with a code texted to the account's number. */
  async function start() {
    if (total > bal.payout_float.available) return setError(`Float is ${money(bal.payout_float.available)} and this batch needs ${money(total)}. Nothing was sent.`);
    setBusy(true);
    setError("");
    try {
      if (mode === "test") await send();
      else {
        const c = await api<{ required: boolean; phone_hint?: string }>("/app/confirmations", { body: { action: "batch", mode, items } });
        if (c.required) setHint(c.phone_hint!);
        else await send();
      }
    } catch (err) {
      setError(`${(err as ApiError).message} Nothing was sent.`);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Bulk payout"
      width={640}
      footer={
        hint ? (
          <button className="btn btn-line" onClick={() => setHint(null)}>Back</button>
        ) : rows.length ? (
          <>
            <button className="btn btn-line" onClick={reset}>Choose another file</button>
            <button className="btn btn-pine" disabled={!valid.length || busy} onClick={start}>
              {busy ? <span className="spinner" /> : <>Pay {valid.length} recipients · {money(total)}</>}
            </button>
          </>
        ) : undefined
      }
    >
      {hint ? (
        <SmsConfirm
          hint={hint}
          summary={`Pay ${valid.length} recipients ${money(total)} in total`}
          onCode={send}
          onResend={() => api("/app/confirmations", { body: { action: "batch", mode, items } })}
        />
      ) : !rows.length ? (
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
            <div className="kpi"><dt>Total to pay</dt><dd style={{ fontSize: 18 }}>{money(total)}</dd><span className="sub">from float {money(bal.payout_float.available)}</span></div>
            <div className="kpi"><dt>Fees</dt><dd style={{ fontSize: 18 }}>{money(fees)}</dd><span className="sub">from fee credit</span></div>
            <div className="kpi"><dt>Recipients</dt><dd style={{ fontSize: 18 }}>{valid.length}</dd><span className="sub">rows with errors are skipped</span></div>
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      )}
    </Modal>
  );
}
