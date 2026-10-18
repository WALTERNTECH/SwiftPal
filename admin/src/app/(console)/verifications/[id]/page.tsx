"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { KV, Modal, PageHeader, useToast } from "@/components/ui";
import { api, invalidate, useApi, type ApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";

type Detail = {
  id: string;
  merchant_id: string;
  kind: "individual" | "business";
  name: string;
  id_number: string;
  reg_number: string | null;
  kra_pin: string | null;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  documents: { id: string; doc_key: string; filename: string; content_type: string; size_bytes: number }[];
  owner: { merchant_name: string; merchant_type: string; email: string; phone: string; first_name: string; last_name: string } | null;
};

const LABEL: Record<string, string> = {
  id_front: "National ID · front",
  id_back: "National ID · back",
  selfie: "Selfie holding ID",
  certificate: "Certificate of incorporation",
  cr12: "CR12",
  director_id_front: "Director's ID · front",
  director_selfie: "Director selfie holding ID",
};

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: v, error } = useApi<Detail>(`/verifications/${id}`);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setFailure("");
    try {
      await api(`/verifications/${id}/${approve ? "approve" : "reject"}`, { body: approve ? {} : { note } });
      await invalidate("/verifications", "/overview", "/merchants");
      toast(approve ? "Verification approved" : "Verification rejected");
      router.push("/verifications");
    } catch (err) {
      setFailure((err as ApiError).message);
      setBusy(false);
    }
  }

  if (!v) {
    return (
      <>
        <PageHeader title="Verification" />
        <section className="panel">
          <div className="empty">{error ? <p className="muted">{error.message}</p> : <span className="spinner" />}</div>
        </section>
      </>
    );
  }

  const pending = v.status === "submitted";
  return (
    <>
      <PageHeader
        title={v.owner?.merchant_name ?? "Verification"}
        sub={
          <>
            <span className={`badge ${v.status === "approved" ? "ok" : v.status === "rejected" ? "bad" : "info"}`}>{v.status === "submitted" ? "Under review" : v.status}</span>{" "}
            · submitted {dateTime(v.submitted_at)}
          </>
        }
        actions={
          pending ? (
            <>
              <button className="btn btn-line" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </button>
              <button className="btn btn-pine" disabled={busy} onClick={() => decide(true)}>
                {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> Approve</>}
              </button>
            </>
          ) : (
            <Link href={`/merchants/${v.merchant_id}`} className="btn btn-line">Open merchant</Link>
          )
        }
      />
      {failure && <div className="form-error">{failure}</div>}

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head"><h3>Documents</h3></div>
          <div className="panel-body">
            <div className="docs-grid">
              {v.documents.map((d) => (
                <div key={d.id} className="doc-tile">
                  {d.content_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/backend/admin/files/${d.id}`} alt={LABEL[d.doc_key] ?? d.doc_key} onClick={() => setZoom(`/backend/admin/files/${d.id}`)} />
                  ) : (
                    <a className="pdf" href={`/backend/admin/files/${d.id}`} target="_blank" rel="noreferrer">
                      <Icon name="receipt" size={26} />
                    </a>
                  )}
                  <b>{LABEL[d.doc_key] ?? d.doc_key}</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Details</h3></div>
          <div className="panel-body">
            <KV
              rows={[
                ["Type", <span key="t" style={{ textTransform: "capitalize" }}>{v.kind}</span>],
                [v.kind === "business" ? "Director" : "Name on ID", v.name],
                ["ID number", <span key="i" className="mono">{v.id_number}</span>],
                ...(v.kind === "business"
                  ? ([
                      ["Registration", <span key="r" className="mono">{v.reg_number}</span>],
                      ["KRA PIN", <span key="k" className="mono">{v.kra_pin}</span>],
                    ] as [string, React.ReactNode][])
                  : []),
                ["Account holder", `${v.owner?.first_name ?? ""} ${v.owner?.last_name ?? ""}`],
                ["Email", v.owner?.email ?? "—"],
                ["Phone", <span key="p" className="mono">{v.owner?.phone ?? "—"}</span>],
                ...(v.reviewer_note ? ([["Review note", v.reviewer_note]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </div>
        </section>
      </div>

      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject verification"
        footer={
          <>
            <button className="btn btn-line" onClick={() => setRejecting(false)}>Cancel</button>
            <button className="btn btn-danger" disabled={busy || note.trim().length < 5} onClick={() => decide(false)}>
              Reject
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="note">What needs changing</label>
          <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The selfie doesn't show the ID clearly." />
          <span className="hint">The merchant sees this.</span>
        </div>
      </Modal>

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" />
        </div>
      )}
    </>
  );
}
