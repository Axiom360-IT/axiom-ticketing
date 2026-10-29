import "server-only";
import { parseResendTime, type ResendEmail } from "./delivery-state";

// ── Reading Resend's own delivery log ─────────────────────────────────
//
// Resend records, per message, what actually happened to it. That record is the
// only place "Resend refused this recipient" shows up, because the send call
// itself reports success either way. This reads it back, read-only, with the
// API key the app already has — no webhook to configure, no new secret.
//
// Polled rather than pushed. A webhook would be faster, but it needs an
// endpoint registered in Resend's dashboard and a signing secret copied into
// the environment, and until both exist it silently does nothing. Polling works
// the moment it is deployed, and ten minutes is quick enough for a problem that
// today goes unnoticed for days.

const BASE = "https://api.resend.com";
const PAGE = 100;
/** Resend allows 2 requests a second. Stay clear of it. */
const PAGE_DELAY_MS = 600;

function apiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

async function resendGet<T>(path: string): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("RESEND_API_KEY is not set");

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${key}`, "user-agent": "axiom-ticketing/1" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    // Rate limited: wait the time they ask for (or a second) and try again,
    // a couple of times, rather than failing a whole sweep on one burst.
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 1;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Resend answered ${res.status} for ${path.split("?")[0]}`);
    }
    return (await res.json()) as T;
  }
}

export function resendConfigured(): boolean {
  return apiKey() !== null;
}

type ListResponse = {
  data?: Array<{
    id: string;
    to?: string[];
    subject?: string;
    created_at: string;
    last_event?: string;
  }>;
  has_more?: boolean;
};

/**
 * Messages sent since `sinceMs`, newest first.
 *
 * Stops as soon as a page reaches back past the cutoff, or at `maxPages`. Both
 * limits matter: a cap alone would cost a full-history crawl on a quiet day, and
 * a cutoff alone would run unbounded on a day with a mail loop.
 */
export async function listEmailsSince(
  sinceMs: number,
  maxPages: number,
): Promise<{ emails: ResendEmail[]; truncated: boolean }> {
  const emails: ResendEmail[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body = await resendGet<ListResponse>(
      `/emails?limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    );
    const rows = body.data ?? [];
    if (rows.length === 0) return { emails, truncated: false };

    let reachedCutoff = false;
    for (const r of rows) {
      const at = parseResendTime(r.created_at);
      if (Number.isFinite(at) && at < sinceMs) {
        reachedCutoff = true;
        continue;
      }
      emails.push({
        id: r.id,
        to: r.to ?? [],
        subject: r.subject ?? "",
        created_at: r.created_at,
        last_event: r.last_event ?? "",
      });
    }
    if (reachedCutoff) return { emails, truncated: false };
    if (!body.has_more) return { emails, truncated: false };

    after = rows[rows.length - 1]?.id;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  // Ran out of pages before reaching the cutoff: say so, so a mail loop shows up
  // as "truncated" in the run history rather than as a quietly short scan.
  return { emails, truncated: true };
}

/** One message's current state. Used right after a test send to say, at once,
 *  whether it got through. */
export async function getEmailEvent(id: string): Promise<string | null> {
  const row = await resendGet<{ last_event?: string }>(
    `/emails/${encodeURIComponent(id)}`,
  );
  return row.last_event ?? null;
}
