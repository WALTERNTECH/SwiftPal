"use client";

import type { IconName } from "@/components/Icon";
import { Icon } from "@/components/Icon";
import { useApi, type ActivityRow } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { device } from "./SecuritySettings";

type D = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

/** Plain-language lines for the security log; tone marks what deserves a second look. */
const KINDS: Record<string, { icon: IconName; tone: "ok" | "warn" | "bad" | "info"; text: (d: D) => string }> = {
  signed_up: { icon: "user", tone: "ok", text: () => "Created the account" },
  signed_in: { icon: "logout", tone: "ok", text: (d) => (d.method === "totp" ? "Signed in with the authenticator app" : d.method === "recovery" ? "Signed in with a recovery code" : d.method === "sms" ? "Signed in with an SMS code" : "Signed in") },
  sign_in_failed: { icon: "alert", tone: "bad", text: () => "Wrong password at sign-in" },
  password_changed: { icon: "lock", tone: "warn", text: () => "Changed the password" },
  password_reset: { icon: "lock", tone: "warn", text: () => "Reset the password by email" },
  two_factor_enabled: { icon: "shield", tone: "ok", text: () => "Turned on two-step verification" },
  two_factor_disabled: { icon: "shield", tone: "bad", text: () => "Turned off two-step verification" },
  two_factor_reset_by_support: { icon: "shield", tone: "warn", text: () => "Two-step verification reset by SwiftPal support" },
  recovery_codes_renewed: { icon: "key", tone: "info", text: () => "Made new recovery codes" },
  recovery_code_used: { icon: "key", tone: "warn", text: () => "Used a recovery code" },
  session_ended: { icon: "logout", tone: "info", text: (d) => `Signed out ${device(d.device as string | null)}` },
  sessions_ended: { icon: "logout", tone: "info", text: (d) => `Signed out ${s(d.count)} other device${d.count === 1 ? "" : "s"}` },
  signed_out_by_support: { icon: "logout", tone: "warn", text: () => "Everyone signed out by SwiftPal support" },
  phone_changed: { icon: "phone", tone: "warn", text: (d) => `Changed the phone number to ${s(d.phone)}` },
  key_created: { icon: "key", tone: "info", text: (d) => `Created ${s(d.mode)} API key "${s(d.name)}"` },
  key_rolled: { icon: "key", tone: "info", text: (d) => `Rolled API key "${s(d.name)}"` },
  key_revoked: { icon: "key", tone: "info", text: () => "Revoked an API key" },
  connect_approved: { icon: "bolt", tone: "warn", text: (d) => `Connected ${s(d.client)}${d.requested_from ? ` (requested from ${s(d.requested_from)})` : ""}` },
  webhook_added: { icon: "webhook", tone: "info", text: (d) => `Added webhook ${s(d.url)}` },
  webhook_removed: { icon: "webhook", tone: "info", text: () => "Removed a webhook endpoint" },
  channel_added: { icon: "channel", tone: "info", text: (d) => `Added ${s(d.kind)} ${s(d.shortcode)}` },
  channel_removed: { icon: "channel", tone: "info", text: () => "Removed a Till or Paybill" },
  member_invited: { icon: "team", tone: "info", text: (d) => `Invited ${s(d.email)} as ${s(d.role)}` },
  member_joined: { icon: "team", tone: "ok", text: (d) => `Joined the team as ${s(d.role)}` },
  member_removed: { icon: "team", tone: "warn", text: (d) => `Removed ${s(d.email)} from the team` },
  member_role_changed: { icon: "team", tone: "info", text: (d) => `Changed ${s(d.email)} from ${s(d.from)} to ${s(d.to)}` },
  invite_revoked: { icon: "team", tone: "info", text: (d) => `Revoked the invite for ${s(d.email)}` },
  withdrawal_sent: { icon: "payout", tone: "warn", text: (d) => `Withdrew ${money(Number(d.amount))} to ${s(d.to)}` },
  refund_sent: { icon: "undo", tone: "info", text: (d) => `Refunded ${money(Number(d.amount))}` },
  link_created: { icon: "link", tone: "info", text: (d) => `Created payment link "${s(d.title)}"` },
  link_enabled: { icon: "link", tone: "info", text: () => "Turned a payment link on" },
  link_disabled: { icon: "link", tone: "info", text: () => "Turned a payment link off" },
  export_downloaded: { icon: "download", tone: "info", text: (d) => `Downloaded ${s(d.kind)} ${s(d.from)} to ${s(d.to)}` },
  verification_submitted: { icon: "idcard", tone: "info", text: () => "Submitted verification documents" },
};

export function ActivityLog() {
  const { data, loading } = useApi<ActivityRow[]>("/app/activity", { refreshMs: 60_000 });
  return (
    <section className="panel">
      <div className="panel-head"><h3>Security activity</h3><span className="muted" style={{ fontSize: 12.5 }}>Last 100 events</span></div>
      {loading && <div className="panel-body"><span className="spinner" /></div>}
      {data?.map((e) => {
        const k = KINDS[e.kind] ?? { icon: "info" as IconName, tone: "info" as const, text: () => e.kind.replace(/_/g, " ") };
        const who = e.first_name ? `${e.first_name} ${e.last_name}` : e.email ?? "SwiftPal";
        return (
          <div key={e.id} className="act-row">
            <span className={`note-ic ${k.tone}`}><Icon name={k.icon} size={13} /></span>
            <div>
              <b>{k.text(e.detail)}</b>
              <div className="muted">
                {who}
                {e.ip ? ` · ${e.ip}` : ""}
                {e.user_agent ? ` · ${device(e.user_agent)}` : ""}
              </div>
            </div>
            <time>{dateTime(e.created_at)}</time>
          </div>
        );
      })}
      {data && !data.length && <div className="panel-body muted">Nothing yet.</div>}
    </section>
  );
}
