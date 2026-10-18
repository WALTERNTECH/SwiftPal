"use client";

import { useEffect, useState } from "react";
import { CodeBlock, CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { api, invalidate, useApi, useMode, type ApiError, type Delivery, type Endpoint } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { VERIFY_SNIPPETS } from "@/lib/snippets";

const EVENTS = [
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "payment.expired",
  "payout.succeeded",
  "payout.failed",
  "payout.reversed",
  "wallet.topped_up",
  "wallet.low_balance",
];

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export default function Webhooks() {
  const mode = useMode();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const { data: hooks, loading } = useApi<Endpoint[]>(`/app/webhooks?mode=${mode}`);
  const { data: deliveries } = useApi<Delivery[]>(`/app/webhooks/deliveries?mode=${mode}`, { refreshMs: 10_000 });

  async function run(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      invalidate("/app/webhooks");
      if (done) toast(done);
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
  }

  async function sendTest(w: Endpoint) {
    setTesting(w.id);
    try {
      const r = await api<{ status: number | null; ok: boolean; error: string | null; ms: number }>(`/app/webhooks/${w.id}/test`, { method: "POST" });
      toast(r.ok ? `Test event delivered to ${host(w.url)} · ${r.status} in ${r.ms} ms` : `Test failed · ${r.status ?? r.error ?? "no response"}`, r.ok ? "check" : "alert");
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
    setTesting(null);
  }

  return (
    <>
      <PageHeader
        title="Webhooks"
        sub="We POST a signed event to your endpoint every time a payment, payout or balance changes state."
        actions={
          <button className="btn btn-pine" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Add endpoint
          </button>
        }
      />

      <section className="panel">
        <div className="panel-head"><h3>Endpoints · {mode}</h3></div>
        {hooks?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>URL</th><th>Events</th><th>Signing secret</th><th>Status</th><th /></tr></thead>
              <tbody>
                {hooks.map((w) => (
                  <tr key={w.id}>
                    <td className="mono" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{w.url}</td>
                    <td className="muted">{w.events.length === EVENTS.length ? "All events" : `${w.events.length} events`}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <span className="secret">{reveal[w.id] ? w.secret : "whsec_" + "•".repeat(14)}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => setReveal({ ...reveal, [w.id]: !reveal[w.id] })} aria-label="Reveal secret">
                          <Icon name={reveal[w.id] ? "eyeOff" : "eye"} size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(w.secret); toast("Signing secret copied"); }} aria-label="Copy secret">
                          <Icon name="copy" size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          role="switch"
                          aria-checked={w.enabled}
                          className="switch"
                          onClick={() => run(() => api(`/app/webhooks/${w.id}`, { method: "PATCH", body: { enabled: !w.enabled } }), w.enabled ? "Endpoint paused" : "Endpoint enabled")}
                          aria-label="Enabled"
                        />
                        <span className="muted" style={{ fontSize: 13 }}>{w.enabled ? "Enabled" : "Paused"}</span>
                      </div>
                    </td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" disabled={testing === w.id} onClick={() => sendTest(w)}>
                          {testing === w.id ? <span className="spinner" /> : "Send test"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--bad)" }}
                          onClick={() => confirm("Delete this endpoint? Pending deliveries to it stop.") && run(() => api(`/app/webhooks/${w.id}`, { method: "DELETE" }), "Endpoint deleted")}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty
            icon="webhook"
            title="No endpoints yet"
            body="Add an HTTPS URL on your server. Without one you'll have to poll for results."
            action={<button className="btn btn-pine" onClick={() => setAdding(true)}>Add endpoint</button>}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent deliveries</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>Retried at 1m, 5m, 30m, 2h, 6h and 15h until your endpoint returns 2xx</span>
        </div>
        {deliveries?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Event</th><th>Object</th><th>Endpoint</th><th>Response</th><th>Attempts</th><th>Time</th><th /></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} title={d.last_error ?? undefined}>
                    <td className="mono">{d.type}</td>
                    <td className="mono muted">{d.object_id?.slice(0, 18) ?? "—"}</td>
                    <td className="mono muted">{host(d.url)}</td>
                    <td>
                      {d.status === "succeeded" ? (
                        <span className="badge ok">{d.last_status} · {d.last_duration_ms}ms</span>
                      ) : d.status === "failed" ? (
                        <span className="badge bad">{d.last_status ?? "No response"} · gave up</span>
                      ) : d.attempts === 0 ? (
                        <span className="badge info">Queued</span>
                      ) : (
                        <span className="badge warn">{d.last_status ?? "No response"} · retry {timeAgo(d.next_attempt_at).replace(" ago", "")}</span>
                      )}
                    </td>
                    <td className="num">{d.attempts}</td>
                    <td className="muted">{dateTime(d.last_attempt_at ?? d.created_at)}</td>
                    <td className="right">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => run(() => api(`/app/webhooks/deliveries/${d.id}/replay`, { method: "POST" }), `Replaying ${d.type}`)}
                      >
                        Replay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="logs" title="No deliveries yet" body="Once an endpoint is enabled, every event we send to it is logged here with its response." />
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>Verify signatures</h3>
        <CodeBlock tabs={VERIFY_SNIPPETS} />
      </section>

      <AddEndpoint open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddEndpoint({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mode = useMode();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setUrl("");
      setEvents(EVENTS);
      setSecret(null);
      setBusy(false);
      setError("");
    }
  }, [open]);

  async function add() {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      return setError("Enter a full URL, starting with https://");
    }
    if (u.protocol !== "https:") return setError("Endpoints must use HTTPS.");
    if (!events.length) return setError("Pick at least one event.");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; secret: string }>("/app/webhooks", { body: { url: u.toString(), events, mode } });
      invalidate("/app/webhooks");
      setSecret(r.secret);
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  if (secret) {
    return (
      <Modal open={open} onClose={onClose} title="Endpoint added" footer={<button className="btn btn-pine" onClick={onClose}>Done</button>}>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Verify the <code className="inline-code">SwiftPal-Signature</code> header on every request with this secret. It&apos;s also under the endpoint&apos;s row.
        </p>
        <div className="keybox">
          <div className="keybox-row">
            <code className="secret" style={{ wordBreak: "break-all" }}>{secret}</code>
            <span className="keybox-copy"><CopyButton text={secret} /></span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${mode} webhook endpoint`}
      width={540}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" onClick={add} disabled={busy}>
            {busy ? <span className="spinner" /> : "Add endpoint"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="wh-url">Endpoint URL</label>
        <input id="wh-url" className="input mono" placeholder="https://api.yourapp.com/webhooks/swiftpal" value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="label-row">
          <legend className="label">Events</legend>
          <button className="link" style={{ border: 0, background: "none", cursor: "pointer", fontSize: 13 }} onClick={() => setEvents(events.length === EVENTS.length ? [] : EVENTS)}>
            {events.length === EVENTS.length ? "Clear all" : "Select all"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          {EVENTS.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={events.includes(e)} onChange={(ev) => setEvents(ev.target.checked ? [...events, e] : events.filter((x) => x !== e))} />
              <span className="mono" style={{ fontSize: 12.5 }}>{e}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
