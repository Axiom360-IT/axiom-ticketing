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
