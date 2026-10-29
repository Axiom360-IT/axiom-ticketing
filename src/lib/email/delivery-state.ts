// ── Turning Resend's delivery log into "who is not getting our email" ──
//
// Pure: no network, no database, so the rules are testable and the monitor
// that uses them stays thin.
//
// Resend's list endpoint gives each message its LATEST state in `last_event`.
// The states that matter here:
//
//   problem   suppressed · bounced · complained
//   good      delivered · opened · clicked
//   ignore    sent · delivery_delayed · queued · scheduled · canceled · failed
//
// "ignore" is deliberate. A message that is merely still in flight says nothing
// about the address, and `failed` is OUR failure to send (a bad API key, a
// quota), not the recipient's: flagging a customer because our quota ran out
// would send a support agent chasing the wrong person.
//
// The rule that makes it self-healing: for each address, whichever of
// "latest problem" and "latest delivered" is MORE RECENT wins. A fix therefore
// clears the flag with no human step as soon as one message gets through, and a
// regression re-opens it.

export type IssueStatus = "suppressed" | "bounced" | "complained";

export type ResendEmail = {
  id: string;
  to: string[];
  subject: string;
  /** ISO timestamp. */
  created_at: string;
  last_event: string;
};

export type IssueRecord = {
  email: string;
  status: IssueStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastEmailId: string | null;
  lastSubject: string | null;
  resolvedAt: Date | null;
};

const PROBLEM = new Set<string>(["suppressed", "bounced", "complained"]);
const GOOD = new Set<string>(["delivered", "opened", "clicked"]);

export function problemStatus(lastEvent: string): IssueStatus | null {
  return PROBLEM.has(lastEvent) ? (lastEvent as IssueStatus) : null;
}

export function isDelivered(lastEvent: string): boolean {
  return GOOD.has(lastEvent);
}

/**
 * Resend sends timestamps Postgres-style — `2026-10-29 20:07:12.328000+00`:
 * a space instead of `T`, six fractional digits, and an offset with no minutes.
 * That happens to parse in current V8, but "happens to" is not a contract and
 * this value decides which of two events is newer, so it is made explicit.
 * Returns NaN for anything unreadable (callers skip those rows).
 */
export function parseResendTime(raw: string): number {
  const iso = raw
    .trim()
    .replace(" ", "T")
    // +00 → +00:00 ; -05 → -05:00 ; leaves +05:30 and Z untouched
    .replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}

export function normalizeAddress(raw: string): string | null {
  // Resend may return "Name <a@b.com>" for `to`.
  const m = raw.match(/<([^>]+)>/);
  const addr = (m?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

type Seen = { at: number; email: ResendEmail };

/**
 * Given a window of Resend's log and what we already know, return only the rows
 * that need writing. Idempotent: running it twice over the same window returns
 * nothing the second time, which is what lets the monitor's windows overlap.
 */
export function reconcile(
  emails: readonly ResendEmail[],
  existing: ReadonlyMap<string, IssueRecord>,
): IssueRecord[] {
  const latestProblem = new Map<string, Seen>();
  const earliestProblem = new Map<string, number>();
  const latestGood = new Map<string, Seen>();

  for (const e of emails) {
    const at = parseResendTime(e.created_at);
    if (!Number.isFinite(at)) continue;
    const isProblem = problemStatus(e.last_event) !== null;
    const isGood = isDelivered(e.last_event);
    if (!isProblem && !isGood) continue;

    for (const raw of e.to) {
      const addr = normalizeAddress(raw);
      if (!addr) continue;
      if (isProblem) {
        const cur = latestProblem.get(addr);
        if (!cur || at > cur.at) latestProblem.set(addr, { at, email: e });
        const first = earliestProblem.get(addr);
        if (first === undefined || at < first) earliestProblem.set(addr, at);
      } else {
        const cur = latestGood.get(addr);
        if (!cur || at > cur.at) latestGood.set(addr, { at, email: e });
      }
    }
  }

  const out: IssueRecord[] = [];
  const addresses = new Set([...latestProblem.keys(), ...latestGood.keys()]);

  for (const addr of addresses) {
    const problem = latestProblem.get(addr);
    const good = latestGood.get(addr);
    const known = existing.get(addr);

    // ── The problem is the most recent thing that happened: open it ──
    if (problem && (!good || problem.at > good.at)) {
      const status = problemStatus(problem.email.last_event) as IssueStatus;
      const firstSeen = Math.min(
        earliestProblem.get(addr) ?? problem.at,
        known ? known.firstSeenAt.getTime() : Infinity,
      );
      const next: IssueRecord = {
        email: addr,
        status,
        firstSeenAt: new Date(firstSeen),
        lastSeenAt: new Date(
          Math.max(problem.at, known ? known.lastSeenAt.getTime() : 0),
        ),
        lastEmailId: problem.email.id,
        lastSubject: problem.email.subject.slice(0, 300),
        resolvedAt: null,
      };
      const unchanged =
        known &&
        known.resolvedAt === null &&
        known.status === next.status &&
        known.lastSeenAt.getTime() === next.lastSeenAt.getTime() &&
        known.firstSeenAt.getTime() === next.firstSeenAt.getTime() &&
        known.lastEmailId === next.lastEmailId;
      if (!unchanged) out.push(next);
      continue;
    }

    // ── A delivery after the last problem: resolve an open issue ──
    // Only if we KNEW about it; a delivery to an address that never had a
    // problem is not news and must not create a row.
    if (good && known && known.resolvedAt === null && good.at > known.lastSeenAt.getTime()) {
      out.push({ ...known, resolvedAt: new Date(good.at) });
    }
  }

  return out;
}
