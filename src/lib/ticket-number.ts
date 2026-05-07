import { sql } from "drizzle-orm";
import { db } from "./db/client";

/** Generates the next human-readable ticket number (e.g. `AX-0042`). */
export async function generateTicketNumber(): Promise<string> {
  const rows = await db.execute<{ num: string }>(
    sql`SELECT generate_ticket_number() AS num`,
  );
  // Drizzle's NeonHttp execute returns objects on `.rows`
  const result = (rows as unknown as { rows: { num: string }[] }).rows ?? rows;
  const first = Array.isArray(result) ? result[0] : (result as { rows?: { num: string }[] }).rows?.[0];
  if (!first?.num) {
    throw new Error("generate_ticket_number() returned no value");
  }
  return first.num;
}
