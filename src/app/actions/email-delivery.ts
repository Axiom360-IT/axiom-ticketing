"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSessionUser } from "@/lib/auth/session";
import { users } from "@/lib/db/schema/auth";
import { db } from "@/lib/db/client";
import { hasOpenIssue, syncDeliveryIssues } from "@/lib/email/delivery-monitor";
import { getEmailEvent, resendConfigured } from "@/lib/email/resend-log";
import { sendEmail } from "@/lib/email/send";
import { enforceUserRateLimit } from "@/lib/ratelimit";

// ── Actions behind the "this customer isn't getting our email" warning ──
//
// Two things a person can do from it: ask for a fresh look at Resend's log, and
// send a test message to find out whether a block has been lifted. Neither
// changes anything about the customer, a ticket, or Resend's configuration.

export type DeliveryActionResult =
  | { ok: true; message: "rechecked"; opened: number; resolved: number }
  | { ok: false; error: string };

export type TestOutcome = "delivered" | "pending" | "blocked";

export type TestEmailResult =
  | { ok: true; outcome: TestOutcome }
  | { ok: false; error: string };

/** Whoever works tickets or manages users may act on this — it is the same
 *  audience that sees the warning. */
async function requireStaffCaller() {
  const caller = await requireSessionUser();
  const allowed =
    !caller.isImpersonating &&
    (caller.permissions.has("tickets.update") ||
      caller.permissions.has("users.update"));
  if (!allowed) throw new Error("Forbidden");
  return caller;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function recheckEmailDelivery(): Promise<DeliveryActionResult> {
  const caller = await requireStaffCaller();
  await enforceUserRateLimit("authSendTestEmail", caller.id);
  try {
    // A short window is enough: this is "did something change in the last
    // while", not a backfill, and it keeps the button quick.
    const r = await syncDeliveryIssues({ hours: 24, pages: 3 });
    if ("skipped" in r) return { ok: false, error: r.skipped };
    revalidatePath("/admin/tickets", "layout");
    revalidatePath("/admin/users", "layout");
    return { ok: true, message: "rechecked", opened: r.opened, resolved: r.resolved };
  } catch (err) {
    console.error("[email-delivery] recheck failed:", err);
    return { ok: false, error: "Could not read the email provider's log. Try again in a minute." };
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export async function sendDeliveryTestEmail(
  rawEmail: string,
): Promise<TestEmailResult> {
  const caller = await requireStaffCaller();
  await enforceUserRateLimit("authSendTestEmail", caller.id);

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, error: "That isn't a valid email address." };
  const to = parsed.data;

  // Only an address ALREADY flagged. Without this the button would be a way to
  // send our branded mail to any address a staff member typed into a request.
  if (!(await hasOpenIssue(to))) {
    return { ok: false, error: "That address isn't currently flagged, so there is nothing to test." };
  }
  if (!resendConfigured()) {
    return { ok: false, error: "Email isn't configured on this server." };
  }

  const [me] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, caller.id))
    .limit(1);
  const requestedBy = me?.name ?? "the support team";

  let id: string | null;
  try {
    const sent = await sendEmail({
      to,
      template: { template: "delivery_test", data: { requestedBy } },
      fromActorName: requestedBy,
      // The whole point: find out whether this address works NOW, which the
      // guard would otherwise decline to even try.
      bypassDeliveryGuard: true,
    });
    id = sent.id;
  } catch (err) {
    console.error("[email-delivery] test send failed:", err);
    return { ok: false, error: "Sending the test failed. Check the email settings and try again." };
  }
  if (!id) return { ok: false, error: "The email provider didn't return a message id." };

  // Resend accepts a send to a suppressed address and then marks it suppressed
  // within a second or so. Looking right away turns "did it work?" from a ten
  // minute wait into an answer on the button. Twice, because delivery itself
  // takes a few seconds longer than suppression does.
  let outcome: TestOutcome = "pending";
  for (const wait of [1500, 3000]) {
    await sleep(wait);
    try {
      const event = await getEmailEvent(id);
      if (event === "suppressed" || event === "bounced" || event === "complained") {
        outcome = "blocked";
        break;
      }
      if (event === "delivered" || event === "opened" || event === "clicked") {
        outcome = "delivered";
        break;
      }
    } catch {
      break; // leave it "pending"; the scheduled check will settle it
    }
  }

  await audit({
    actorId: caller.id,
    action: "email.delivery_test",
    targetType: "email",
    targetId: to,
    after: { outcome },
  });

  // Fold the result into the flag now rather than waiting for the next
  // scheduled run, so the warning clears (or stays) the instant the page
  // refreshes.
  try {
    await syncDeliveryIssues({ hours: 2, pages: 2 });
  } catch {
    /* the scheduled check will catch up */
  }
  revalidatePath("/admin/tickets", "layout");
  revalidatePath("/admin/users", "layout");

  return { ok: true, outcome };
}
