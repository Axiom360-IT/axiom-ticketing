import { eq, like } from "drizzle-orm";
import { db } from "./client";
import { messages } from "./schema/messages";
import { tickets } from "./schema/tickets";

/**
 * One-shot, idempotent cleanup: strip the legacy "[Other category: <text>]"
 * prefix that an old version of the submission forms jammed onto the front of
 * the ticket description / first message body. The live code path that built
 * that prefix was already removed; this fixes the EXISTING rows so the thread
 * no longer renders "[Other category: Testing]" at the top.
 *
 * Initial-message bodies for those tickets are plain text (the prefix was
 * followed by "\n\n"); the regex also tolerates a single leading <p> wrapper
 * just in case. Re-runs are no-ops once a row is clean. Run via
 * `pnpm db:backfill-category-prefix`.
 */
const PREFIX = /^\s*(?:<p>\s*)?\[Other category:[^\]]*\]\s*(?:<\/p>)?\s*/i;

async function main(): Promise<void> {
  // ── Message bodies ────────────────────────────────────────────────
  const msgRows = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(like(messages.body, "%[Other category:%"));

  let msgFixed = 0;
  for (const r of msgRows) {
    const stripped = r.body.replace(PREFIX, "");
    if (stripped !== r.body) {
      await db
        .update(messages)
        .set({ body: stripped })
        .where(eq(messages.id, r.id));
      msgFixed += 1;
    }
  }

  // ── Ticket descriptions ───────────────────────────────────────────
  const ticketRows = await db
    .select({ id: tickets.id, description: tickets.description })
    .from(tickets)
    .where(like(tickets.description, "%[Other category:%"));

  let ticketFixed = 0;
  for (const r of ticketRows) {
    const stripped = r.description.replace(PREFIX, "");
    if (stripped !== r.description) {
      await db
        .update(tickets)
        .set({ description: stripped })
        .where(eq(tickets.id, r.id));
      ticketFixed += 1;
    }
  }

  console.log(
    `Cleanup complete. Stripped the "[Other category: …]" prefix from ` +
      `${msgFixed} message(s) and ${ticketFixed} ticket description(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
