"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal, PageHeader, useToast } from "@/components/ui";
import { api, invalidate, useApi, useMe, type Admin, type ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export default function Team() {
  const toast = useToast();
  const { data: me } = useMe();
  const { data: team } = useApi<Admin[]>("/admins");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "admin" as "admin" | "owner" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = me?.admin?.role === "owner";

  async function act(path: string, done: string) {
    try {
      await api(path, { method: "POST" });
      await invalidate("/admins", "/audit");
      toast(done);
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
  }

  return (
    <>
      <PageHeader
        title="Team"
        actions={
          owner && (
            <button className="btn btn-pine" onClick={() => { setF({ name: "", email: "", password: "", role: "admin" }); setError(""); setAdding(true); }}>
              <Icon name="plus" size={15} /> Add admin
            </button>
          )
        }
      />
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Two-step</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(team ?? []).map((a) => (
                <tr key={a.id}>
                  <td>
                    <b style={{ fontWeight: 500 }}>{a.name}</b>
                    <div className="dim" style={{ fontSize: 12 }}>{a.email}</div>
                  </td>
                  <td><span className={`badge ${a.role === "owner" ? "pine" : ""}`}>{a.role === "owner" ? "Owner" : "Admin"}</span></td>
                  <td>{a.totp_enabled_at ? <span className="badge ok">On</span> : <span className="badge warn">Not set up</span>}</td>
                  <td className="muted">{a.last_login_at ? timeAgo(a.last_login_at) : "Never"}</td>
                  <td>{a.disabled_at ? <span className="badge bad">Disabled</span> : <span className="badge ok">Active</span>}</td>
                  <td className="right">
                    {owner && a.id !== me?.admin?.id && (
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => confirm(`Reset two-step sign-in for ${a.name}? They set it up again at their next sign-in.`) && act(`/admins/${a.id}/reset-2fa`, "Two-step sign-in reset")}>
                          Reset 2FA
                        </button>
                        {a.disabled_at ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => act(`/admins/${a.id}/enable`, "Admin re-enabled")}>Enable</button>
                        ) : (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} onClick={() => confirm(`Disable ${a.name}? They're signed out at once.`) && act(`/admins/${a.id}/disable`, "Admin disabled")}>
                            Disable
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add admin"
        footer={
          <>
            <button className="btn btn-line" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn btn-pine"
              disabled={busy}
              onClick={async () => {
                if (f.name.trim().length < 2 || !f.email.includes("@")) return setError("Enter a name and email.");
                if (f.password.length < 12) return setError("The starting password needs at least 12 characters.");
                setBusy(true);
                setError("");
                try {
                  await api("/admins", { body: { name: f.name.trim(), email: f.email.trim(), password: f.password, role: f.role } });
                  await invalidate("/admins", "/audit");
                  toast("Admin added");
                  setAdding(false);
                } catch (err) {
                  setError((err as ApiError).message);
                }
                setBusy(false);
              }}
            >
              {busy ? <span className="spinner" /> : "Add admin"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="an">Name</label>
            <input id="an" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ae">Email</label>
            <input id="ae" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="ap">Starting password</label>
            <input id="ap" className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ar">Role</label>
            <select id="ar" className="select input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "owner" })}>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>
        <p className="hint">They set up their authenticator app at first sign-in.</p>
        {error && <div className="form-error">{error}</div>}
      </Modal>
    </>
  );
}
