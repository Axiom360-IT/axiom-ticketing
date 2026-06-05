import "server-only";
import { inngest } from "@/inngest/client";

/**
 * Fire a `billing/balance.changed` event for each distinct organization id
 * (nulls dropped). MUST be called AFTER the surrounding transaction commits —
 * the balance monitor re-reads the committed balance to decide whether to send
 * the over-plan accountant alert (req 8.6). Best-effort: a send failure is
 * logged but never rolls back or fails the caller's work.
 */
export async function notifyBalanceChanged(
  organizationIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(organizationIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  try {
    await inngest.send(
      ids.map((organizationId) => ({
        name: "billing/balance.changed" as const,
        data: { organizationId },
      })),
    );
  } catch (err) {
    console.error("[billing] balance.changed emit failed:", err);
  }
}
