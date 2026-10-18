"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Icon } from "@/components/Icon";
import { api, invalidate, useAccount, useApi, type ApiError, type SecurityState } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { Modal, useToast } from "./ui";

/** "Chrome on Windows" from a user-agent string; good enough to recognise your own devices. */
export function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|python|axios/i.test(ua) ? "Script" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SecuritySettings() {
  const { data: s } = useApi<SecurityState>("/app/security");
  if (!s) return <section className="panel panel-body"><span className="spinner" /></section>;
  return (
    <>
      <TwoFactor state={s} />
      <Password changedAt={s.password_changed_at} />
      <Sessions state={s} />
    </>
  );
}

// ---------- two-step verification ----------
function TwoFactor({ state }: { state: SecurityState }) {
  const tf = state.two_factor;
  const [setup, setSetup] = useState(false);
  const [off, setOff] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [renew, setRenew] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head"><h3>Two-step verification</h3></div>
      <div className="sec-row">
        <span className={`sec-ic ${tf.enabled ? "on" : ""}`}><Icon name="shield" size={17} /></span>
        <div className="grow">
          <b>Authenticator app</b>
          <span className="muted">
            {tf.enabled
              ? `On since ${dateTime(tf.enabled_at!)}. Asked at sign-in and before money leaves the account.`
              : "A code from Google Authenticator, Microsoft Authenticator or 1Password at sign-in and before money leaves. Required for payouts and withdrawals."}
          </span>
        </div>
        {tf.enabled ? (
          <span className="badge ok">On</span>
        ) : (
          <button className="btn btn-pine btn-sm" onClick={() => setSetup(true)}>Turn on</button>
        )}
      </div>
      {tf.enabled && (
        <div className="sec-row">
          <span className="sec-ic"><Icon name="key" size={16} /></span>
          <div className="grow">
            <b>Recovery codes</b>
            <span className="muted">{tf.recovery_codes_left} of 10 unused. Each signs you in once if you lose your phone.</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-line btn-sm" onClick={() => setRenew(true)}>New codes</button>
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} onClick={() => setOff(true)}>Turn off</button>
          </div>
        </div>
      )}
      <SetupModal open={setup} onClose={() => setSetup(false)} onDone={(c) => { setSetup(false); setCodes(c); }} />
      <CodeModal
        open={renew}
        title="New recovery codes"
        body="Your old codes stop working. Enter a code from your authenticator app to continue."
        action="Make new codes"
        onClose={() => setRenew(false)}
        submit={async (code) => {
          const r = await api<{ recovery_codes: string[] }>("/app/security/2fa/recovery-codes", { body: { code } });
          setRenew(false);
          setCodes(r.recovery_codes);
          invalidate("/app/security");
        }}
      />
      <TurnOff open={off} onClose={() => setOff(false)} />
      <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />
    </section>
  );
}

function SetupModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (codes: string[]) => void }) {
  const [secret, setSecret] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode("");
    setError("");
    setQr("");
    api<{ secret: string; otpauth_url: string }>("/app/security/2fa/setup", { method: "POST" })
      .then(async (s) => {
        setSecret(s);
        setQr(await QRCode.toDataURL(s.otpauth_url, { margin: 0, width: 300, errorCorrectionLevel: "M" }));
      })
      .catch((e: ApiError) => setError(e.message));
  }, [open]);

  async function enable() {
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the app.");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ recovery_codes: string[] }>("/app/security/2fa/enable", { body: { code } });
      await invalidate("/app/me", "/app/security");
      onDone(r.recovery_codes);
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Turn on two-step verification"
      width={540}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" disabled={busy || !secret} onClick={enable}>
            {busy ? <span className="spinner" /> : "Turn on"}
          </button>
        </>
      }
    >
      <ol className="steps-list" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6, fontSize: 13.5 }}>
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or 1Password).</li>
        <li>Scan this code, or type the key.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      <div className="qr-box">
        {qr ? <img src={qr} alt="QR code for your authenticator app" /> : <span className="spinner" />}
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Setup key</span>
          <div className="secret-key">{secret?.secret.match(/.{1,4}/g)?.join(" ") ?? "…"}</div>
          <span className="hint">The account shows as SwiftPal in the app.</span>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="tf-code">Code from the app</label>
        <input
          id="tf-code"
          className="input mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && enable()}
        />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function RecoveryCodes({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [codes]);
  if (!codes) return null;
  const text = `SwiftPal recovery codes\nEach works once.\n\n${codes.join("\n")}\n`;
  return (
    <Modal
      open
      onClose={() => saved && onClose()}
      title="Save your recovery codes"
      footer={
        <button className="btn btn-pine" disabled={!saved} onClick={onClose}>
          I&apos;ve saved them
        </button>
      }
    >
      <p className="muted" style={{ fontSize: 13.5 }}>
        If you lose your phone, each code signs you in once. This is the only time they&apos;re shown. Keep them somewhere safe, away from your phone.
      </p>
      <div className="codes-grid">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-line btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setSaved(true);
            toast("Codes copied");
          }}
        >
          <Icon name="copy" size={14} /> Copy
        </button>
        <button
          className="btn btn-line btn-sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            a.download = "swiftpal-recovery-codes.txt";
            a.click();
            setSaved(true);
          }}
        >
          <Icon name="download" size={14} /> Download
        </button>
        <label className="check" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>Saved</span>
        </label>
      </div>
    </Modal>
  );
}

function TurnOff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setError("");
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Turn off two-step verification"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Keep it on</button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/app/security/2fa/disable", { body: { password, code } });
                await invalidate("/app/me", "/app/security");
                toast("Two-step verification is off");
                onClose();
              } catch (e) {
                setError((e as ApiError).message);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : "Turn off"}
          </button>
        </>
      }
    >
      <div className="callout warn">
        <Icon name="alert" size={16} />
        <span>Without it, payouts and withdrawals stop until you turn it back on, and a stolen password is enough to sign in.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="off-pw">Password</label>
        <PasswordInput id="off-pw" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>
      <div className="field">
        <label className="label" htmlFor="off-code">Code from your authenticator app</label>
        <input id="off-code" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

/** One authenticator code, then an action. */
function CodeModal({ open, onClose, title, body, action, submit }: { open: boolean; onClose: () => void; title: string; body: string; action: string; submit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setCode("");
      setError("");
    }
  }, [open]);
  async function go() {
    setBusy(true);
    setError("");
    try {
      await submit(code);
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" disabled={busy || code.length !== 6} onClick={go}>
            {busy ? <span className="spinner" /> : action}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5 }}>{body}</p>
      <input className="input mono" inputMode="numeric" maxLength={6} aria-label="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && go()} />
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

// ---------- password ----------
function Password({ changedAt }: { changedAt: string | null }) {
  const me = useAccount();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setF({ current: "", next: "", confirm: "" });
      setError("");
    }
  }, [open]);
  return (
    <section className="panel">
      <div className="panel-head"><h3>Password</h3></div>
      <div className="sec-row">
        <span className="sec-ic"><Icon name="lock" size={16} /></span>
        <div className="grow">
          <b>Password</b>
          <span className="muted">{changedAt ? `Changed ${timeAgo(changedAt)}` : `Set when you joined, ${dateTime(me.user.created_at)}`}</span>
        </div>
        <button className="btn btn-line btn-sm" onClick={() => setOpen(true)}>Change</button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change password"
        footer={
          <>
            <button className="btn btn-line" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn btn-pine"
              disabled={busy}
              onClick={async () => {
                if (f.next.length < 10) return setError("Use at least 10 characters.");
                if (f.next !== f.confirm) return setError("The new passwords don't match.");
                setBusy(true);
                setError("");
                try {
                  await api("/app/security/password", { body: { current_password: f.current, new_password: f.next } });
                  invalidate("/app/security");
                  toast("Password changed. Other devices were signed out.");
                  setOpen(false);
                } catch (e) {
                  setError((e as ApiError).message);
                }
                setBusy(false);
              }}
            >
              {busy ? <span className="spinner" /> : "Change password"}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="pw-cur">Current password</label>
          <PasswordInput id="pw-cur" value={f.current} onChange={(v) => setF({ ...f, current: v })} autoComplete="current-password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-new">New password</label>
          <PasswordInput id="pw-new" value={f.next} onChange={(v) => setF({ ...f, next: v })} autoComplete="new-password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-conf">Confirm new password</label>
          <PasswordInput id="pw-conf" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" />
        </div>
        <p className="hint">Other devices are signed out when it changes.</p>
        {error && <div className="form-error">{error}</div>}
      </Modal>
    </section>
  );
}

// ---------- sessions ----------
function Sessions({ state }: { state: SecurityState }) {
  const toast = useToast();
  const others = state.sessions.filter((s) => !s.current).length;
  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      await invalidate("/app/security");
      toast(done);
    } catch (e) {
      toast((e as ApiError).message, "alert");
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Where you&apos;re signed in</h3>
        {others > 0 && (
          <button className="btn btn-line btn-sm" onClick={() => run(() => api("/app/security/sessions/sign-out-others", { method: "POST" }), "Signed out everywhere else")}>
            Sign out other devices
          </button>
        )}
      </div>
      {state.sessions.map((s) => (
        <div key={s.id} className="device">
          <span className="sec-ic"><Icon name={/Android|iPhone/.test(s.user_agent ?? "") ? "phone" : "device"} size={16} /></span>
          <div className="grow">
            <b>{device(s.user_agent)}</b>
            <div className="muted">
              {s.ip ?? "Unknown address"} · {s.current ? "This device" : `Active ${timeAgo(s.last_seen_at)}`}
            </div>
          </div>
          {s.current ? (
            <span className="badge pine">Current</span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => run(() => api(`/app/security/sessions/${s.id}`, { method: "DELETE" }), "Signed out that device")}>
              Sign out
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
