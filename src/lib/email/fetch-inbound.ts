import "server-only";
import { htmlToPlainText } from "@/lib/messages/sanitize";

// Resend's `email.received` webhook is METADATA-ONLY by design — the body,
// headers, and attachments are NOT in the payload. They must be fetched from
// the Receiving API by the email's id:
//   GET https://api.resend.com/emails/receiving/{id}   (Bearer RESEND_API_KEY)
// (https://resend.com/docs/dashboard/receiving/get-email-content). Without this
// our processor sees an empty body and drops every reply as "empty-body".

const RESEND_API = "https://api.resend.com";

export type ResendInboundContent = {
  text: string | null;
  html: string | null;
  /** Lower-cased header map (includes Authentication-Results, DKIM, etc.). */
  headers: Record<string, string>;
};

/**
 * Fetch a received email's full body + headers from Resend. Returns null on any
 * failure (missing key, network, non-2xx) so the caller can retry rather than
 * silently process an empty message.
 */
export async function fetchResendInboundContent(
  emailId: string,
): Promise<ResendInboundContent | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[email/inbound] RESEND_API_KEY not set; cannot fetch body");
    return null;
  }

  let res: Response;
  try {
    res = await fetch(
      `${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
  } catch (err) {
    console.error("[email/inbound] received-email fetch failed:", err);
    return null;
  }
  if (!res.ok) {
    console.error(`[email/inbound] received-email fetch returned ${res.status}`);
    return null;
  }

  let body: {
    text?: string | null;
    html?: string | null;
    headers?: Record<string, string | string[]> | null;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.error("[email/inbound] received-email body not JSON:", err);
    return null;
  }

  const headers: Record<string, string> = {};
  if (body.headers && typeof body.headers === "object") {
    for (const [k, v] of Object.entries(body.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v)
        ? String(v[0] ?? "")
        : String(v ?? "");
    }
  }

  const html = body.html ?? null;
  // Prefer the plain-text part; fall back to a text render of the HTML so an
  // HTML-only reply still threads (otherwise the empty-body filter drops it).
  const text = body.text ?? (html ? htmlToPlainText(html) : null);

  return { text, html, headers };
}

// ── Inbound attachments ─────────────────────────────────────────────────
//
// Resend's inbound webhook carries only attachment METADATA, and even the
// received-email content endpoint omits the bytes. Attachments are listed and
// downloaded separately (https://resend.com/docs/dashboard/receiving/attachments):
//   GET /emails/receiving/{id}/attachments        → [{ id, filename, size,
//        content_type, download_url, expires_at, … }]
// Each `download_url` is a short-lived signed URL to the raw bytes. We list at
// ingest time (not webhook time) so the URLs are fresh on an Inngest retry.

export type InboundAttachmentMeta = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
};

// One page is plenty — real support emails don't carry hundreds of files, and
// the per-file size/type/magic-byte gates run downstream regardless.
const ATTACHMENT_PAGE_LIMIT = 100;

/**
 * List a received email's attachments (metadata + fresh signed download URLs).
 * Returns [] on any failure or when there are none — a missing attachment must
 * never fail the surrounding ingest (the message body still posts).
 */
export async function fetchResendInboundAttachments(
  emailId: string,
): Promise<InboundAttachmentMeta[]> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[email/inbound] RESEND_API_KEY not set; cannot list attachments");
    return [];
  }

  let res: Response;
  try {
    res = await fetch(
      `${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=${ATTACHMENT_PAGE_LIMIT}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
  } catch (err) {
    console.error("[email/inbound] attachment list fetch failed:", err);
    return [];
  }
  if (!res.ok) {
    console.error(`[email/inbound] attachment list returned ${res.status}`);
    return [];
  }

  let body: {
    data?: Array<{
      filename?: string | null;
      content_type?: string | null;
      size?: number | null;
      download_url?: string | null;
    }>;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.error("[email/inbound] attachment list body not JSON:", err);
    return [];
  }

  const items = Array.isArray(body.data) ? body.data : [];
  const out: InboundAttachmentMeta[] = [];
  for (const a of items) {
    if (!a || typeof a.download_url !== "string" || a.download_url.length === 0) {
      continue;
    }
    out.push({
      filename: (a.filename ?? "attachment").toString(),
      contentType: (a.content_type ?? "application/octet-stream")
        .toString()
        .toLowerCase(),
      sizeBytes: typeof a.size === "number" ? a.size : 0,
      downloadUrl: a.download_url,
    });
  }
  return out;
}

/**
 * Download an attachment's raw bytes from its signed `download_url`, capping at
 * `maxBytes` so a hostile Content-Length can't exhaust memory. Returns null on
 * any failure or when the body exceeds the cap.
 */
export async function downloadInboundAttachment(
  downloadUrl: string,
  maxBytes: number,
): Promise<Buffer | null> {
  let res: Response;
  try {
    res = await fetch(downloadUrl);
  } catch (err) {
    console.error("[email/inbound] attachment download failed:", err);
    return null;
  }
  if (!res.ok) {
    console.error(`[email/inbound] attachment download returned ${res.status}`);
    return null;
  }

  // Trust nothing: bail early on an oversized declared length, then re-check the
  // actual byte count after reading.
  const declaredLen = Number(res.headers.get("content-length") ?? "0");
  if (declaredLen > maxBytes) {
    console.warn("[email/inbound] attachment exceeds size cap (declared); skipped");
    return null;
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  } catch (err) {
    console.error("[email/inbound] attachment read failed:", err);
    return null;
  }
}
