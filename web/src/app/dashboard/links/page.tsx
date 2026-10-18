"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { api, can, invalidate, useAccount, useApi, type ApiError, type PaymentLink } from "@/lib/api";
import { money, timeAgo } from "@/lib/format";

export default function PaymentLinks() {
  const me = useAccount();
  const toast = useToast();
  const { data: links, loading } = useApi<PaymentLink[]>("/app/links", { refreshMs: 30_000 });
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState<PaymentLink | null>(null);
  const live = me.merchant.live_enabled;
  const edit = can(me, "collect");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1" && live && edit) setCreating(true);
  }, [live, edit]);

  async function toggle(l: PaymentLink) {
    try {
      await api(`/app/links/${l.id}`, { method: "PATCH", body: { active: !l.active } });
      await invalidate("/app/links");
      toast(l.active ? "Link turned off" : "Link turned on");
    } catch (e) {
      toast((e as ApiError).message, "alert");
    }
  }

  return (
    <>
      <PageHeader
        title="Payment links"
        sub="A page your customers pay from with M-Pesa. Share it on WhatsApp, Instagram or as a QR code. No code needed."
        actions={
          edit && (
            <button className="btn btn-pine" disabled={!live} onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> Create link
            </button>
          )
        }
      />

      {!live && (
        <div className="callout warn rise">
          <Icon name="idcard" size={16} />
          <span className="grow"><b>Payment links work once your account is verified.</b></span>
          <Link href="/dashboard/verification" className="btn btn-line btn-sm">Verification</Link>
        </div>
      )}

      <section className="panel rise">
        {links?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Link</th><th className="right">Price</th><th className="right">Paid</th><th>Status</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td style={{ maxWidth: 320 }}>
                      <b style={{ fontWeight: 500 }}>{l.title}</b>
                      <div className="link-url">
                        <span>{l.url.replace(/^https?:\/\//, "")}</span>
                        <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Copy link" onClick={async () => { await navigator.clipboard.writeText(l.url); toast("Link copied"); }}>
                          <Icon name="copy" size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="right num">{l.amount === null ? <span className="muted">Customer chooses</span> : money(l.amount)}</td>
                    <td className="right">
                      <span className="num">{money(l.paid_total)}</span>
                      <div className="muted" style={{ fontSize: 12 }}>{l.paid_count} payment{l.paid_count === 1 ? "" : "s"}</div>
                    </td>
                    <td>{l.active ? <span className="badge ok">Taking payments</span> : <span className="badge">Off</span>}</td>
                    <td className="muted">{timeAgo(l.created_at)}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-line btn-sm" onClick={() => setSharing(l)}>
                          <Icon name="share" size={14} /> Share
                        </button>
                        {edit && (
                          <button className="btn btn-ghost btn-sm" onClick={() => toggle(l)}>{l.active ? "Turn off" : "Turn on"}</button>
                        )}
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
            icon="link"
            title="No payment links yet"
            body="Make one for a product, a service or donations. Customers open it, enter their number and approve the M-Pesa prompt."
            action={edit && live ? <button className="btn btn-pine btn-sm" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Create link</button> : undefined}
          />
        )}
      </section>

      <CreateLink open={creating} onClose={() => setCreating(false)} onCreated={(l) => { setCreating(false); setSharing(l); }} />
      <ShareLink link={sharing} onClose={() => setSharing(null)} />
    </>
  );
}

function CreateLink({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (l: PaymentLink) => void }) {
  const me = useAccount();
  const [f, setF] = useState({ title: "", description: "", fixed: true, amount: "", reference: "", channel: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setF({ title: "", description: "", fixed: true, amount: "", reference: "", channel: "" });
      setError("");
    }
  }, [open]);
  const channels = me.channels.filter((c) => c.status === "verified");

  async function create() {
    const amount = Math.floor(Number(f.amount) || 0);
    if (f.title.trim().length < 2) return setError("Give the link a name your customers will recognise.");
    if (f.fixed && (amount < 1 || amount > 250_000)) return setError("Set a price between KES 1 and KES 250,000.");
    setBusy(true);
    setError("");
    try {
      const l = await api<PaymentLink>("/app/links", {
        body: {
          title: f.title.trim(),
          description: f.description.trim() || null,
          amount: f.fixed ? amount : null,
          reference: f.reference.trim() || undefined,
          channel: f.channel || null,
        },
      });
      await invalidate("/app/links");
      onCreated(l);
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a payment link"
      width={520}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" disabled={busy} onClick={create}>{busy ? <span className="spinner" /> : "Create link"}</button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="pl-title">What it&apos;s for</label>
        <input id="pl-title" className="input" maxLength={80} placeholder="Maize flour 2kg, Consultation, Donations" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div className="segmented" role="group" aria-label="Price">
        <button aria-pressed={f.fixed} onClick={() => setF({ ...f, fixed: true })}>Fixed price</button>
        <button aria-pressed={!f.fixed} onClick={() => setF({ ...f, fixed: false })}>Customer chooses</button>
      </div>
      {f.fixed && (
        <div className="field">
          <label className="label" htmlFor="pl-amt">Price</label>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input id="pl-amt" className="input mono" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} />
          </div>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="pl-desc">Description <span className="dim">· optional</span></label>
        <textarea id="pl-desc" className="input" rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="pl-ref">M-Pesa reference <span className="dim">· optional</span></label>
          <input id="pl-ref" className="input mono" maxLength={12} placeholder="Auto" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value.replace(/[^A-Za-z0-9 _-]/g, "") })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pl-ch">Pay into</label>
          <select id="pl-ch" className="select input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            <option value="">Default channel</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.kind === "till" ? "Till" : "Paybill"} {c.shortcode} · {c.display_name}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function ShareLink({ link, onClose }: { link: PaymentLink | null; onClose: () => void }) {
  const me = useAccount();
  const toast = useToast();
  const [qr, setQr] = useState("");
  useEffect(() => {
    setQr("");
    if (link) QRCode.toDataURL(link.url, { margin: 1, width: 600, errorCorrectionLevel: "M" }).then(setQr);
  }, [link]);
  if (!link) return null;
  const text = `Pay ${me.merchant.name} for ${link.title}${link.amount ? ` (${money(link.amount)})` : ""} with M-Pesa: ${link.url}`;
  return (
    <Modal open onClose={onClose} title="Share your link" width={460} footer={<button className="btn btn-pine" onClick={onClose}>Done</button>}>
      <div className="secret-key" style={{ fontSize: 12.5 }}>{link.url}</div>
      <div className="share-row">
        <button className="btn btn-line btn-sm" onClick={async () => { await navigator.clipboard.writeText(link.url); toast("Link copied"); }}>
          <Icon name="copy" size={14} /> Copy
        </button>
        <a className="btn btn-line btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          <Icon name="share" size={14} /> WhatsApp
        </a>
        <a className="btn btn-line btn-sm" href={link.url} target="_blank" rel="noreferrer">
          <Icon name="external" size={14} /> Open
        </a>
      </div>
      <div className="qr-print">
        {qr ? <img src={qr} alt={`QR code for ${link.title}`} /> : <span className="spinner" />}
        <b>{link.title}</b>
        <span style={{ fontSize: 13 }}>Scan to pay {me.merchant.name} with M-Pesa</span>
      </div>
      {qr && (
        <a className="btn btn-line btn-sm" href={qr} download={`swiftpal-${link.slug}-qr.png`} style={{ justifySelf: "start" }}>
          <Icon name="download" size={14} /> Download QR for printing
        </a>
      )}
    </Modal>
  );
}
