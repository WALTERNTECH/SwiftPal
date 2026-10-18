"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useMode } from "@/lib/api";
import { Modal, useToast } from "./ui";

type Kind = "payments" | "payouts" | "statement";
const TITLE: Record<Kind, string> = { payments: "Export payments", payouts: "Export payouts", statement: "Download statement" };

// Calendar days in Nairobi, which is what the server's ranges are in.
const day = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
function presets() {
  const now = new Date(Date.now() + 3 * 3_600_000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  return [
    { label: "Last 30 days", from: day(new Date(Date.now() - 29 * 86_400_000)), to: day(new Date()) },
    { label: "This month", from: iso(y, m, 1), to: day(new Date()) },
    { label: "Last month", from: iso(y, m - 1, 1), to: iso(y, m, 0) },
    { label: "This year", from: iso(y, 0, 1), to: day(new Date()) },
  ];
}

/** A CSV for the books, over any date range up to a year. */
export function ExportButton({ kind, className = "btn btn-line", small }: { kind: Kind; className?: string; small?: boolean }) {
  const mode = useMode();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const p = presets();
  const [from, setFrom] = useState(p[0].from);
  const [to, setTo] = useState(p[0].to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/backend/app/exports/${kind}?mode=${mode}&from=${from}&to=${to}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(j?.error?.message ?? `Download failed (${res.status}).`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `swiftpal-${kind}.csv`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast("Downloaded");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <button className={small ? `${className} btn-sm` : className} onClick={() => setOpen(true)}>
        <Icon name="download" size={small ? 14 : 15} /> {kind === "statement" ? "Statement" : "Export"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={TITLE[kind]}
        footer={
          <>
            <button className="btn btn-line" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-pine" disabled={busy} onClick={download}>
              {busy ? <span className="spinner" /> : "Download CSV"}
            </button>
          </>
        }
      >
        <div className="amount-chips" style={{ marginTop: 0 }}>
          {p.map((x) => (
            <button key={x.label} type="button" aria-pressed={from === x.from && to === x.to} onClick={() => { setFrom(x.from); setTo(x.to); }}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="ex-from">From</label>
            <input id="ex-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ex-to">To</label>
            <input id="ex-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="hint">
          {kind === "statement" ? "Every movement on your fee credit and payout float, with references." : "Opens in Excel, Google Sheets or Numbers. Times are East Africa Time."}
        </p>
        {error && <div className="form-error">{error}</div>}
      </Modal>
    </>
  );
}
