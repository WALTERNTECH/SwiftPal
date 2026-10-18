"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, can, invalidate, useAccount, useApi, type ApiError, type Invite, type Member, type Role } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Modal, useToast } from "./ui";

export const ROLES: { v: Exclude<Role, "owner">; t: string; d: string }[] = [
  { v: "admin", t: "Admin", d: "Everything except managing the team" },
  { v: "finance", t: "Finance", d: "Payments, payouts, withdrawals, refunds and statements" },
  { v: "developer", t: "Developer", d: "API keys, webhooks and request logs" },
  { v: "support", t: "Support", d: "Reads payments and payouts to help customers; changes nothing" },
];
const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", developer: "Developer", finance: "Finance", support: "Support" };

export function TeamSettings() {
  const me = useAccount();
  const toast = useToast();
  const owner = can(me, "team");
  const { data } = useApi<{ members: Member[]; invites: Invite[] }>("/app/team");
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      await invalidate("/app/team");
      toast(done);
    } catch (e) {
      toast((e as ApiError).message, "alert");
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Team</h3>
        {owner && (
          <button className="btn btn-pine btn-sm" onClick={() => setInviting(true)}>
            <Icon name="plus" size={14} /> Invite
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Two-step</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {(data?.members ?? []).map((m) => (
              <tr key={m.id}>
                <td>
                  <b style={{ fontWeight: 500 }}>{m.first_name} {m.last_name}{m.id === me.user.id && <span className="dim"> · you</span>}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{m.email}</div>
                </td>
                <td><span className={`badge ${m.role === "owner" ? "pine" : ""}`}>{ROLE_NAME[m.role]}</span></td>
                <td>{m.two_factor ? <span className="badge ok">On</span> : <span className="badge warn">Off</span>}</td>
                <td className="muted">{m.last_active_at ? timeAgo(m.last_active_at) : "—"}</td>
                <td className="right">
                  {owner && m.role !== "owner" && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(m)}>Manage</button>
                  )}
                </td>
              </tr>
            ))}
            {(data?.invites ?? []).map((i) => (
              <tr key={i.id}>
                <td>
                  <b style={{ fontWeight: 500 }}>{i.email}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>Invited {timeAgo(i.created_at)} · link expires {timeAgo(i.expires_at).replace(" ago", "")}</div>
                </td>
                <td><span className="badge">{ROLE_NAME[i.role]}</span></td>
                <td><span className="badge info">Invited</span></td>
                <td className="muted">—</td>
                <td className="right">
                  {owner && (
                    <button className="btn btn-ghost btn-sm" onClick={() => run(() => api(`/app/team/invites/${i.id}`, { method: "DELETE" }), "Invite revoked")}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body muted" style={{ fontSize: 13, borderTop: "1px solid var(--line)" }}>
        {ROLES.map((r) => (
          <div key={r.v}><b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{r.t}</b> · {r.d}</div>
        ))}
        <div style={{ marginTop: 6 }}>Withdrawals only ever go to the owner&apos;s verified number, whoever sends them.</div>
      </div>

      <InviteModal open={inviting} onClose={() => setInviting(false)} onSent={(url, email) => { setInviting(false); setLink({ url, email }); }} />
      <LinkModal link={link} onClose={() => setLink(null)} />
      <ManageModal
        member={editing}
        onClose={() => setEditing(null)}
        onRole={(role) => run(() => api(`/app/team/members/${editing!.id}`, { method: "PATCH", body: { role } }), "Role changed").then(() => setEditing(null))}
        onRemove={() => run(() => api(`/app/team/members/${editing!.id}`, { method: "DELETE" }), "Removed from the team").then(() => setEditing(null))}
      />
    </section>
  );
}

function InviteModal({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (url: string, email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setEmail("");
      setRole("developer");
      setError("");
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite to your team"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-pine"
            disabled={busy}
            onClick={async () => {
              if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter their work email.");
              setBusy(true);
              setError("");
              try {
                const r = await api<{ invite_url: string }>("/app/team/invites", { body: { email: email.trim(), role } });
                await invalidate("/app/team");
                onSent(r.invite_url, email.trim());
              } catch (e) {
                setError((e as ApiError).message);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : "Create invite"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="inv-email">Email</label>
        <input id="inv-email" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">Role</span>
        <div className="stack" style={{ gap: 8 }}>
          {ROLES.map((r) => (
            <label key={r.v} className={`role-opt ${role === r.v ? "on" : ""}`}>
              <input type="radio" name="role" checked={role === r.v} onChange={() => setRole(r.v)} />
              <span>
                <b>{r.t}</b>
                <span className="muted">{r.d}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

/** Shown once: the link works for seven days and only once. */
function LinkModal({ link, onClose }: { link: { url: string; email: string } | null; onClose: () => void }) {
  const toast = useToast();
  if (!link) return null;
  return (
    <Modal open onClose={onClose} title="Send them this link" footer={<button className="btn btn-pine" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ fontSize: 13.5 }}>
        We&apos;ve emailed {link.email} too. The link works once, for 7 days. Share it only with them: it creates their account.
      </p>
      <div className="secret-key" style={{ fontSize: 12.5 }}>{link.url}</div>
      <div className="share-row">
        <button className="btn btn-line btn-sm" onClick={async () => { await navigator.clipboard.writeText(link.url); toast("Link copied"); }}>
          <Icon name="copy" size={14} /> Copy link
        </button>
        <a className="btn btn-line btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`Join our team on SwiftPal: ${link.url}`)}`} target="_blank" rel="noreferrer">
          <Icon name="share" size={14} /> WhatsApp
        </a>
      </div>
    </Modal>
  );
}

function ManageModal({ member, onClose, onRole, onRemove }: { member: Member | null; onClose: () => void; onRole: (r: Exclude<Role, "owner">) => void; onRemove: () => void }) {
  const [role, setRole] = useState<Exclude<Role, "owner">>("developer");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (member && member.role !== "owner") setRole(member.role);
    setConfirming(false);
  }, [member]);
  if (!member) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${member.first_name} ${member.last_name}`}
      footer={
        <>
          {confirming ? (
            <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={onRemove}>Yes, remove them</button>
          ) : (
            <button className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--bad)" }} onClick={() => setConfirming(true)}>Remove from team</button>
          )}
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" disabled={role === member.role} onClick={() => onRole(role)}>Save role</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 8 }}>
        {ROLES.map((r) => (
          <label key={r.v} className={`role-opt ${role === r.v ? "on" : ""}`}>
            <input type="radio" name="mrole" checked={role === r.v} onChange={() => setRole(r.v)} />
            <span>
              <b>{r.t}</b>
              <span className="muted">{r.d}</span>
            </span>
          </label>
        ))}
      </div>
      {confirming && <p className="hint" style={{ color: "var(--bad)" }}>They&apos;re signed out at once and can&apos;t sign in again unless re-invited.</p>}
    </Modal>
  );
}
