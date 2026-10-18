"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/dash/ui";
import { VerificationWizard } from "@/components/dash/VerificationWizard";
import { useAccount } from "@/lib/api";
import { dateTime } from "@/lib/format";

export default function Verification() {
  const me = useAccount();
  const vs = me.merchant.verification_status;
  if (vs === "submitted" || vs === "approved") return <Status />;
  return (
    <>
      <PageHeader title="Verification" />
      <VerificationWizard />
    </>
  );
}

function Status() {
  const me = useAccount();
  const info = me.verification;
  const approved = me.merchant.verification_status === "approved";
  return (
    <>
      <PageHeader title="Verification" />
      <section className="panel rise">
        <div className="vf-status">
          <div className={`ring-big ${approved ? "ok" : ""}`}>
            <Icon name={approved ? "check" : "clock"} size={32} strokeWidth={approved ? 2.4 : 1.6} />
          </div>
          <div>
            <h2 style={{ fontSize: 22 }}>{approved ? "Verified" : "In review"}</h2>
            <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
              {approved ? "Add your Till or Paybill to start receiving payments." : "We're reviewing your documents."}
            </p>
            {approved && (
              <Link href="/dashboard/channels" className="btn btn-pine" style={{ marginTop: 16 }}>
                Add Till or Paybill
              </Link>
            )}
          </div>
          <ol className="vf-track">
            <li className="done"><i />Submitted</li>
            <li className={approved ? "done" : "now"}><i />Review</li>
            <li className={approved ? "done" : ""}><i />Verified</li>
          </ol>
        </div>
        {info && (
          <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}>
            <dl className="kv">
              <div><dt>Account type</dt><dd style={{ textTransform: "capitalize" }}>{info.kind}</dd></div>
              <div><dt>Name</dt><dd>{info.name}</dd></div>
              <div><dt>Documents</dt><dd>{info.documents.length} files</dd></div>
              <div><dt>Submitted</dt><dd>{dateTime(info.submitted_at)}</dd></div>
              {info.reviewed_at && <div><dt>{approved ? "Approved" : "Reviewed"}</dt><dd>{dateTime(info.reviewed_at)}</dd></div>}
            </dl>
          </div>
        )}
      </section>
    </>
  );
}
