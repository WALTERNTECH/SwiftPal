"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, useToast } from "@/components/dash/ui";
import { dateTime } from "@/lib/format";
import { approveVerification, submitVerification, useStore } from "@/lib/store";

type Kind = "individual" | "business";
type Doc = { key: string; label: string; art: "front" | "back" | "selfie" | "doc"; selfie?: boolean };

const DOCS: Record<Kind, Doc[]> = {
  individual: [
    { key: "id_front", label: "National ID · front", art: "front" },
    { key: "id_back", label: "National ID · back", art: "back" },
    { key: "selfie", label: "Selfie holding your ID", art: "selfie", selfie: true },
  ],
  business: [
    { key: "certificate", label: "Certificate of incorporation", art: "doc" },
    { key: "cr12", label: "CR12", art: "doc" },
    { key: "director_id_front", label: "Director's ID · front", art: "front" },
    { key: "director_selfie", label: "Director selfie holding ID", art: "selfie", selfie: true },
  ],
};

const STEPS = ["Account type", "Details", "Documents", "Review"];

export default function Verification() {
  const s = useStore();
  if (s.verification === "submitted" || s.verification === "approved") return <Status />;
  return <Wizard />;
}

function Wizard() {
  const s = useStore();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>(s.business?.type === "individual" ? "individual" : "business");
  const [f, setF] = useState({
    name: `${s.account?.firstName ?? ""} ${s.account?.lastName ?? ""}`.trim(),
    idNumber: "",
    company: s.business?.type !== "individual" ? s.business?.name ?? "" : "",
    regNumber: "",
    kraPin: "",
  });
  const [files, setFiles] = useState<Record<string, { name: string; url: string | null }>>({});
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const docs = DOCS[kind];

  // Previews are object URLs; release them when the page goes away, not on every change.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => Object.values(filesRef.current).forEach((x) => x.url && URL.revokeObjectURL(x.url)), []);

  const detailsOk =
    kind === "individual"
      ? f.name.trim().split(/\s+/).length >= 2 && /^\d{6,9}$/.test(f.idNumber)
      : f.company.trim().length > 1 && f.regNumber.trim().length > 3 && /^P\d{9}[A-Z]$/.test(f.kraPin) && f.name.trim().split(/\s+/).length >= 2 && /^\d{6,9}$/.test(f.idNumber);
  const docsOk = docs.every((d) => files[d.key]);

  function next() {
    setError("");
    if (step === 1 && !detailsOk) {
      if (kind === "individual") return setError(!/^\d{6,9}$/.test(f.idNumber) ? "Enter your national ID number." : "Enter your full name as on your ID.");
      return setError(!/^P\d{9}[A-Z]$/.test(f.kraPin) ? "Company KRA PIN format: P051234567X." : "Complete every field.");
    }
    if (step === 2 && !docsOk) return setError("Add every document.");
    setStep(step + 1);
  }

  const req = [
    { t: kind === "individual" ? "Full name and ID number" : "Company and director details", ok: detailsOk },
    ...docs.map((d) => ({ t: d.label, ok: !!files[d.key] })),
  ];

  return (
    <>
      <PageHeader title="Verification" sub={kind === "individual" ? "National ID and a selfie holding it." : "Company documents and a director's ID."} />

      <div className="vf">
        <section className="panel rise">
          <div className="panel-head">
            <ol className="mstep" style={{ flex: 1 }} aria-label="Progress">
              {STEPS.map((t, i) => (
                <li key={t} className={i < step ? "done" : i === step ? "now" : ""}>
                  <span>{i < step ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>

          <div className="panel-body stack" style={{ gap: 18 }} key={step}>
            {step === 0 && (
              <div className="vf-type rise">
                {(
                  [
                    { v: "individual", t: "Individual", d: "Developer, freelancer or sole trader", icon: "user" },
                    { v: "business", t: "Business", d: "Registered company or organisation", icon: "building" },
                  ] as const
                ).map((o) => (
                  <label key={o.v} className={`vf-opt ${kind === o.v ? "on" : ""}`}>
                    <input type="radio" name="kind" checked={kind === o.v} onChange={() => { setKind(o.v); setFiles({}); }} />
                    <span className="vf-ic"><Icon name={o.icon} size={16} /></span>
                    <b>{o.t}</b>
                    <span>{o.d}</span>
                  </label>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="form-grid rise">
                {kind === "business" && (
                  <>
                    <div className="field full">
                      <label className="label" htmlFor="co">Registered company name</label>
                      <input id="co" className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="rn">Registration number</label>
                      <input id="rn" className="input mono" placeholder="PVT-XXXXXXX" value={f.regNumber} onChange={(e) => setF({ ...f, regNumber: e.target.value.toUpperCase() })} />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="kp">Company KRA PIN</label>
                      <input id="kp" className="input mono" placeholder="P051234567X" value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value.toUpperCase() })} />
                    </div>
                  </>
                )}
                <div className="field">
                  <label className="label" htmlFor="nm">{kind === "individual" ? "Full name (as on ID)" : "Director's full name"}</label>
                  <input id="nm" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="idn">{kind === "individual" ? "National ID number" : "Director's ID number"}</label>
                  <input id="idn" className="input mono" inputMode="numeric" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value.replace(/\D/g, "").slice(0, 9) })} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="uploads rise">
                {docs.map((d) => (
                  <UploadTile key={d.key} doc={d} file={files[d.key]} onPick={(file) => setFiles((x) => ({ ...x, [d.key]: file }))} />
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="stack rise" style={{ gap: 14 }}>
                <dl className="kv">
                  <div><dt>Account type</dt><dd style={{ textTransform: "capitalize" }}>{kind}</dd></div>
                  {kind === "business" && (
                    <>
                      <div><dt>Company</dt><dd>{f.company}</dd></div>
                      <div><dt>Registration</dt><dd className="mono">{f.regNumber}</dd></div>
                      <div><dt>KRA PIN</dt><dd className="mono">{f.kraPin}</dd></div>
                    </>
                  )}
                  <div><dt>{kind === "individual" ? "Name" : "Director"}</dt><dd>{f.name}</dd></div>
                  <div><dt>ID number</dt><dd className="mono">{f.idNumber.replace(/\d(?=\d{3})/g, "•")}</dd></div>
                </dl>
                <div className="uploads" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                  {docs.map((d) => (
                    <div key={d.key} className="upload has" style={{ gridTemplateRows: "96px auto", cursor: "default" }}>
                      <div className="upload-art">
                        {files[d.key]?.url ? <img src={files[d.key]!.url!} alt="" /> : <Icon name="receipt" size={22} />}
                      </div>
                      <div className="upload-meta"><b style={{ fontSize: 12 }}>{d.label}</b></div>
                    </div>
                  ))}
                </div>
                <label className="check">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <span>The details and documents are accurate and belong to me{kind === "business" ? " or my company" : ""}.</span>
                </label>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}
          </div>

          <div className="modal-foot" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-ghost" onClick={() => { setError(""); setStep(Math.max(0, step - 1)); }} disabled={step === 0}>
              <Icon name="arrowLeft" size={14} /> Back
            </button>
            {step < 3 ? (
              <button className="btn btn-ink" onClick={next}>
                Continue <Icon name="arrowRight" size={14} className="arrow" />
              </button>
            ) : (
              <button
                className="btn btn-pine"
                disabled={!confirm}
                onClick={() => {
                  submitVerification({
                    kind,
                    name: kind === "business" ? f.company : f.name,
                    idNumber: f.idNumber,
                    regNumber: kind === "business" ? f.regNumber : undefined,
                    kraPin: kind === "business" ? f.kraPin : undefined,
                    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.name])),
                  });
                  toast("Submitted for review");
                }}
              >
                Submit for review
              </button>
            )}
          </div>
        </section>

        <aside className="vf-side">
          <section className="panel panel-body rise" style={{ ["--d" as string]: "60ms" }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Requirements</div>
            <ul className="req-list">
              {req.map((r) => (
                <li key={r.t} className={r.ok ? "ok" : ""}>
                  <Icon name={r.ok ? "check" : "info"} size={14} strokeWidth={r.ok ? 2.4 : 1.6} />
                  {r.t}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel panel-body rise" style={{ ["--d" as string]: "120ms", fontSize: 12.5 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Photo tips</div>
            <ul className="req-list" style={{ fontSize: 12.5 }}>
              <li><Icon name="camera" size={14} /> All four corners visible</li>
              <li><Icon name="eye" size={14} /> Face and ID clear, no glare</li>
              <li><Icon name="upload" size={14} /> JPG, PNG or PDF up to 10 MB</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

function UploadTile({ doc, file, onPick }: { doc: Doc; file?: { name: string; url: string | null }; onPick: (f: { name: string; url: string | null }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label className={`upload ${file ? "has" : ""}`}>
      <input
        ref={input}
        type="file"
        accept={doc.selfie ? "image/*" : "image/*,.pdf"}
        capture={doc.selfie ? "user" : undefined}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          onPick({ name: f.name, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
        }}
      />
      <div className="upload-art">
        {file?.url ? <img src={file.url} alt="" /> : file ? <Icon name="receipt" size={26} /> : <Guide art={doc.art} />}
        {file && (
          <span className="upload-badge">
            <Icon name="check" size={12} strokeWidth={2.6} />
          </span>
        )}
      </div>
      <div className="upload-meta">
        <Icon name={doc.selfie ? "camera" : "upload"} size={14} />
        <b>{doc.label}</b>
        <span className={file ? "ok" : ""}>{file ? "Replace" : doc.selfie ? "Take or upload" : "Upload"}</span>
      </div>
    </label>
  );
}

/** Outline drawings that show what each photo should look like. */
function Guide({ art }: { art: Doc["art"] }) {
  if (art === "selfie") {
    return (
      <svg className="guide" viewBox="0 0 120 90" aria-hidden>
        <circle className="g" cx="48" cy="32" r="14" />
        <path className="g" d="M24 84c2-16 12-26 24-26s22 10 24 26" />
        <rect className="g-s" x="66" y="44" width="40" height="26" rx="3" />
        <circle className="g-s" cx="76" cy="55" r="4" />
        <path className="g-s" d="M85 52h15M85 58h11" />
      </svg>
    );
  }
  if (art === "doc") {
    return (
      <svg className="guide" viewBox="0 0 120 90" aria-hidden>
        <path className="g" d="M38 10h34l12 12v58H38z" />
        <path className="g" d="M46 34h28M46 44h28M46 54h20" />
      </svg>
    );
  }
  return (
    <svg className="guide" viewBox="0 0 120 90" aria-hidden>
      <rect className="g" x="14" y="16" width="92" height="58" rx="5" />
      {art === "front" ? (
        <>
          <circle className="g-s" cx="38" cy="42" r="10" />
          <path className="g-s" d="M26 64c2-7 7-10 12-10s10 3 12 10M60 34h34M60 44h28M60 54h22" />
        </>
      ) : (
        <path className="g-s" d="M26 32h68M26 42h68M26 52h44M26 62h56" />
      )}
    </svg>
  );
}

function Status() {
  const s = useStore();
  const toast = useToast();
  const info = s.verificationInfo;
  const approved = s.verification === "approved";
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
              {approved ? "Live payouts are enabled." : `We'll email ${s.account?.email} when it's done.`}
            </p>
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
              <div><dt>Documents</dt><dd>{Object.keys(info.files).length} files</dd></div>
              <div><dt>Submitted</dt><dd>{dateTime(info.submittedAt)}</dd></div>
              {info.reviewedAt && <div><dt>Approved</dt><dd>{dateTime(info.reviewedAt)}</dd></div>}
            </dl>
          </div>
        )}
        {!approved && (
          <div className="modal-foot" style={{ justifyContent: "space-between" }}>
            <span className="hint">Preview build: approval comes from the SwiftPal admin console.</span>
            <button className="btn btn-line btn-sm" onClick={() => { approveVerification(); toast("Verification approved"); }}>
              Simulate approval
            </button>
          </div>
        )}
      </section>
    </>
  );
}
