"use client";

import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { Empty, PageHeader, useToast } from "@/components/dash/ui";
import { dateTime } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { removeChannel, setDefaultChannel, useStore, verifyChannel } from "@/lib/store";

export default function Channels() {
  const s = useStore();
  const toast = useToast();
  const { open } = useActions();

  return (
    <>
      <PageHeader
        title="Channels"
        sub="Tills and Paybills your STK Push requests route to"
        actions={
          <button className="btn btn-pine" onClick={() => open("channel")}>
            <Icon name="plus" size={15} /> Add channel
          </button>
        }
      />

      {s.channels.length ? (
        <div className="tile-grid">
          {s.channels.map((c, i) => (
            <div key={c.id} className="panel channel-card rise" style={{ ["--d" as string]: `${i * 60}ms` }}>
              <div className="spread">
                <span className={`tag ${c.kind === "till" ? "post" : "get"}`}>{c.kind === "till" ? "TILL · BUY GOODS" : "PAYBILL"}</span>
                {c.status === "verified" ? <span className="badge ok">Verified</span> : <span className="badge warn">Unverified</span>}
              </div>
              <div>
                <div className="channel-code">{c.shortcode}</div>
                <div className="muted" style={{ fontSize: 13 }}>{c.displayName}</div>
              </div>
              <dl className="kv" style={{ fontSize: 13 }}>
                {c.kind === "paybill" && (
                  <div><dt>Account number</dt><dd className="mono">{c.accountNumber ?? "—"}</dd></div>
                )}
                <div><dt>Channel ID</dt><dd className="mono">{c.id}</dd></div>
                <div><dt>Default</dt><dd>{c.isDefault ? "Yes" : "No"}</dd></div>
                <div><dt>Added</dt><dd>{dateTime(c.createdAt)}</dd></div>
              </dl>
              <div className="row wrap">
                {c.status !== "verified" && (
                  <button className="btn btn-pine btn-sm" onClick={() => { verifyChannel(c.id); toast(`${c.shortcode} verified`); }}>
                    Verify with KES 1
                  </button>
                )}
                {!c.isDefault && (
                  <button className="btn btn-line btn-sm" onClick={() => { setDefaultChannel(c.id); toast("Default channel updated"); }}>
                    Make default
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (confirm(`Remove ${c.label}?`)) {
                      removeChannel(c.id);
                      toast("Channel removed");
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <section className="panel rise">
          <Empty
            icon="channel"
            title="No channels yet"
            body={`Add a Till or Paybill. It's confirmed with a KES 1 prompt and the first one adds KES ${STARTER_CREDIT} credit.`}
            action={<button className="btn btn-pine" onClick={() => open("channel")}>Add channel</button>}
          />
        </section>
      )}
    </>
  );
}
