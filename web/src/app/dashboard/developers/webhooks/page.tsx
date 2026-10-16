"use client";

import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { dateTime } from "@/lib/format";
import { VERIFY_SNIPPETS } from "@/lib/snippets";
import { addWebhook, removeWebhook, toggleWebhook, useStore } from "@/lib/store";

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

export default function Webhooks() {
  const s = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const hooks = s.webhooks.filter((w) => w.mode === s.mode);

  // Deliveries are derived from settled transactions; one per event per enabled endpoint.
  const deliveries = useMemo(() => {
    const live = hooks.filter((h) => h.enabled);
    if (!live.length) return [];
    const evts = [
      ...s.payments.filter((p) => p.mode === s.mode && p.status !== "pending").map((p) => ({ id: p.id, type: `payment.${p.status}`, at: p.createdAt })),
      ...s.payouts.filter((p) => p.mode === s.mode && p.status !== "processing").map((p) => ({ id: p.id, type: `payout.${p.status}`, at: p.createdAt })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return evts.slice(0, 25).flatMap((e, i) =>
      live
        .filter((h) => h.events.includes(e.type))
        .map((h) => ({ ...e, url: h.url, code: i % 11 === 4 ? 500 : 200, ms: 30 + ((i * 37) % 180), attempts: i % 11 === 4 ? 2 : 1 })),
    );
  }, [hooks, s.payments, s.payouts, s.mode]);

  return (
    <>
      <PageHeader
        title="Webhooks"
        sub="We POST a signed event to your endpoint every time a payment, payout or balance changes state."
        actions={
          <button className="btn btn-ink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Add endpoint
          </button>
        }
      />

      <section className="panel">
        <div className="panel-head"><h3>Endpoints</h3></div>
        {hooks.length ? (
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
                        <button role="switch" aria-checked={w.enabled} className="switch" onClick={() => toggleWebhook(w.id)} aria-label="Enabled" />
                        <span className="muted" style={{ fontSize: 13 }}>{w.enabled ? "Enabled" : "Paused"}</span>
                      </div>
                    </td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => toast(`Test event sent to ${new URL(w.url).host} · 200 OK`)}>Send test</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} onClick={() => confirm("Delete this endpoint?") && removeWebhook(w.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="webhook"
            title="No endpoints yet"
            body="Add an HTTPS URL on your server. Without one you'll have to poll for results."
            action={<button className="btn btn-ink" onClick={() => setAdding(true)}>Add endpoint</button>}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent deliveries</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>Retried at 1m, 5m, 30m, 2h, 6h and 15h until your endpoint returns 2xx</span>
        </div>
        {deliveries.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Event</th><th>Object</th><th>Endpoint</th><th>Response</th><th>Attempts</th><th>Time</th><th /></tr></thead>
              <tbody>
                {deliveries.map((d, i) => (
                  <tr key={d.id + d.url + i}>
                    <td className="mono">{d.type}</td>
                    <td className="mono muted">{d.id.slice(0, 18)}</td>
                    <td className="mono muted">{new URL(d.url).host}</td>
                    <td>{d.code === 200 ? <span className="badge ok">200 · {d.ms}ms</span> : <span className="badge bad">500 · retrying</span>}</td>
                    <td className="num">{d.attempts}</td>
                    <td className="muted">{dateTime(d.at)}</td>
                    <td className="right"><button className="btn btn-ghost btn-sm" onClick={() => toast(`Replayed ${d.type}`, "refresh")}>Replay</button></td>
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
  const s = useStore();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS);
  const [error, setError] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add webhook endpoint"
      width={540}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-ink"
            onClick={() => {
              let u: URL;
              try {
                u = new URL(url);
              } catch {
                return setError("Enter a full URL, starting with https://");
              }
              if (u.protocol !== "https:") return setError("Endpoints must use HTTPS.");
              if (/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) return setError("We can't reach private addresses. Use a public URL or a tunnel.");
              if (!events.length) return setError("Pick at least one event.");
              addWebhook(u.toString(), events, s.mode);
              toast("Endpoint added");
              setUrl("");
              setError("");
              onClose();
            }}
          >
            Add endpoint
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="wh-url">Endpoint URL</label>
        <input id="wh-url" className="input mono" placeholder="https://api.yourapp.co.ke/webhooks/swiftpal" value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} />
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
