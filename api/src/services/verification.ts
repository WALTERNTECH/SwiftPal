import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, newId, open, seal, token } from "../lib.js";
import { STARTER_CREDIT_CENTS } from "../pricing.js";
import type { Merchant } from "./accounts.js";
import { credit } from "./wallet.js";

export type Kind = "individual" | "business";

/** Individuals: national ID front and back, and a selfie holding it. */
export const REQUIRED: Record<Kind, string[]> = {
  individual: ["id_front", "id_back", "selfie"],
  business: ["certificate", "cr12", "director_id_front", "director_selfie"],
};

const MAX_BYTES = 10 * 1024 * 1024;

/** Trust the bytes, not the filename or the browser's content type. */
export function sniff(b: Buffer): { type: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { type: "image/webp", ext: "webp" };
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf", ext: "pdf" };
  const brand = b.subarray(4, 12).toString("latin1");
  if (brand.startsWith("ftyp") && /heic|heix|mif1|msf1/.test(brand)) return { type: "image/heic", ext: "heic" };
  return null;
}

export type Upload = { docKey: string; filename: string; bytes: Buffer };

export async function submit(
  app: App,
  merchant: Merchant,
  fields: { kind: Kind; name: string; idNumber: string; regNumber?: string; kraPin?: string },
  files: Upload[],
) {
  if (merchant.verification_status === "approved") throw new ApiError(409, "already_verified", "This account is already verified.");
  if (merchant.verification_status === "submitted") throw new ApiError(409, "in_review", "Verification is already in review.");
  if (!REQUIRED[fields.kind]) throw new ApiError(400, "invalid_kind", "Kind must be individual or business.");
  if (fields.name.trim().split(/\s+/).length < 2) throw new ApiError(400, "invalid_name", "Enter the full name as it appears on the ID.");
  if (!/^\d{6,9}$/.test(fields.idNumber)) throw new ApiError(400, "invalid_id_number", "Enter a valid national ID number.");
  if (fields.kind === "business") {
    if (!fields.regNumber || fields.regNumber.trim().length < 4) throw new ApiError(400, "invalid_registration", "Enter the company registration number.");
    if (!/^P\d{9}[A-Z]$/.test(fields.kraPin ?? "")) throw new ApiError(400, "invalid_kra_pin", "Company KRA PIN format: P051234567X.");
  }
  const byKey = new Map(files.map((f) => [f.docKey, f]));
  const missing = REQUIRED[fields.kind].filter((k) => !byKey.has(k));
  if (missing.length) throw new ApiError(400, "missing_documents", `Missing: ${missing.join(", ")}.`, "invalid_request", { missing });

  const vid = newId("vrf");
  const stored: { id: string; docKey: string; filename: string; type: string; size: number; key: string }[] = [];
  for (const k of REQUIRED[fields.kind]) {
    const f = byKey.get(k)!;
    if (f.bytes.length > MAX_BYTES) throw new ApiError(413, "file_too_large", `${k} is larger than 10 MB.`);
    const kind = sniff(f.bytes);
    if (!kind) throw new ApiError(415, "unsupported_file", `${k} must be a JPG, PNG, WEBP, HEIC or PDF.`);
    if (k.includes("selfie") && kind.type === "application/pdf") throw new ApiError(415, "unsupported_file", "The selfie must be a photo.");
    const key = `${merchant.id}/${vid}/${k}-${token(6)}.${kind.ext}`;
    await app.storage.put(key, f.bytes, kind.type);
    stored.push({ id: newId("vfl"), docKey: k, filename: f.filename.slice(0, 200), type: kind.type, size: f.bytes.length, key });
  }

  await app.db.tx(async (q) => {
    await q.query(`insert into verifications (id, merchant_id, kind, name, id_number_enc, reg_number, kra_pin) values ($1,$2,$3,$4,$5,$6,$7)`, [
      vid,
      merchant.id,
      fields.kind,
      fields.name.trim(),
      seal(app.cfg.masterKey, fields.idNumber),
      fields.regNumber?.trim().toUpperCase() ?? null,
      fields.kraPin ?? null,
    ]);
    for (const s of stored) {
      await q.query(`insert into verification_files (id, verification_id, doc_key, filename, content_type, size_bytes, storage_key) values ($1,$2,$3,$4,$5,$6,$7)`, [
        s.id,
        vid,
        s.docKey,
        s.filename,
        s.type,
        s.size,
        s.key,
      ]);
    }
    await q.query(`update merchants set verification_status = 'submitted', type = case when $2 = 'individual' then 'individual' else type end where id = $1`, [merchant.id, fields.kind]);
  });
  return current(app, merchant.id);
}

export async function current(app: App, merchantId: string) {
  const v = await one<{ id: string; kind: Kind; name: string; status: string; submitted_at: string; reviewed_at: string | null; reviewer_note: string | null }>(
    app.db,
    `select id, kind, name, status, submitted_at, reviewed_at, reviewer_note from verifications where merchant_id = $1 order by submitted_at desc limit 1`,
    [merchantId],
  );
  if (!v) return null;
  const { rows } = await app.db.query(`select doc_key, filename, content_type, size_bytes from verification_files where verification_id = $1`, [v.id]);
  return { ...v, documents: rows };
}

// ---------- review (admin) ----------

export async function listForReview(app: App, status = "submitted") {
  const { rows } = await app.db.query(
    `select v.id, v.merchant_id, v.kind, v.name, v.reg_number, v.kra_pin, v.status, v.submitted_at, v.reviewed_at, m.name as merchant_name, u.email
     from verifications v join merchants m on m.id = v.merchant_id join users u on u.merchant_id = m.id and u.role = 'owner'
     where v.status = $1 order by v.submitted_at`,
    [status],
  );
  return rows;
}

export async function reviewDetail(app: App, id: string) {
  const v = await one<{ id: string; id_number_enc: string } & Record<string, unknown>>(app.db, `select * from verifications where id = $1`, [id]);
  if (!v) throw new ApiError(404, "not_found", "No such verification.", "not_found");
  const { rows } = await app.db.query(`select id, doc_key, filename, content_type, size_bytes from verification_files where verification_id = $1`, [id]);
  const { id_number_enc, ...rest } = v;
  return { ...rest, id_number: open(app.cfg.masterKey, id_number_enc), documents: rows };
}

export async function reviewFile(app: App, fileId: string) {
  const f = await one<{ storage_key: string; content_type: string; filename: string }>(app.db, `select storage_key, content_type, filename from verification_files where id = $1`, [fileId]);
  if (!f) throw new ApiError(404, "not_found", "No such file.", "not_found");
  const blob = await app.storage.get(f.storage_key);
  if (!blob) throw new ApiError(404, "not_found", "File is missing from storage.", "not_found");
  return { ...blob, filename: f.filename };
}

export async function decide(app: App, id: string, approve: boolean, note?: string) {
  return app.db.tx(async (q) => {
    const v = await one<{ merchant_id: string; status: string }>(q, `select merchant_id, status from verifications where id = $1 for update`, [id]);
    if (!v) throw new ApiError(404, "not_found", "No such verification.", "not_found");
    if (v.status !== "submitted") throw new ApiError(409, "already_reviewed", `This verification is already ${v.status}.`);
    await q.query(`update verifications set status = $2, reviewer_note = $3, reviewed_at = now() where id = $1`, [id, approve ? "approved" : "rejected", note ?? null]);
    await q.query(`update merchants set verification_status = $2 where id = $1`, [v.merchant_id, approve ? "approved" : "rejected"]);
    if (approve) {
      const m = await one<{ starter_credit_given: boolean }>(q, `select starter_credit_given from merchants where id = $1`, [v.merchant_id]);
      await q.query(`update merchants set live_enabled = true, starter_credit_given = true where id = $1`, [v.merchant_id]);
      if (!m?.starter_credit_given) await credit(q, v.merchant_id, "live", "fee", STARTER_CREDIT_CENTS, "starter_credit", id);
      await q.query(`update api_keys set scopes = array_append(scopes, 'payouts:write') where merchant_id = $1 and mode = 'live' and revoked_at is null and not ('payouts:write' = any(scopes))`, [
        v.merchant_id,
      ]);
    }
    return { id, status: approve ? "approved" : "rejected" };
  });
}
