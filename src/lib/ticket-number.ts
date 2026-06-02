import { sql } from "drizzle-orm";
import { db } from "./db/client";

/**
 * Generates the next human-readable ticket number.
 *
 * Format (Meeting-2, CR-07): `<ORG_ABBREV>-<YYYYMMDD>-<NNN>`, e.g.
 * `KI-20260522-001`. The Postgres `generate_ticket_number()` function owns the
 * atomic per-(prefix, day) sequence. The number is stored on the ticket row at
 * creation and never regenerated, so a later reply never spawns a new ticket.
 *
 * @param prefix   Organization abbreviation (e.g. "KI"). Non-alphanumerics are
 *                 stripped and it is upper-cased; falls back to "AX" when empty
 *                 (guest tickets with no matched organization).
 * @param timeZone IANA business timezone used to derive the YYYYMMDD date so the
 *                 number reflects local wall-clock. Defaults to UTC.
 */
export async function generateTicketNumber(
  prefix = "AX",
  timeZone = "UTC",
): Promise<string> {
  const rows = await db.execute<{ num: string }>(
    sql`SELECT generate_ticket_number(${prefix}, ${timeZone}) AS num`,
  );
  // Drizzle's NeonHttp execute returns objects on `.rows`
  const result = (rows as unknown as { rows: { num: string }[] }).rows ?? rows;
  const first = Array.isArray(result) ? result[0] : (result as { rows?: { num: string }[] }).rows?.[0];
  if (!first?.num) {
    throw new Error("generate_ticket_number() returned no value");
  }
  return first.num;
}
