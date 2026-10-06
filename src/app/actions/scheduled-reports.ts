"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { isReauthFresh, reauthRequiredResult } from "@/lib/auth/reauth";
import { requireSessionUser } from "@/lib/auth/session";
import {
  type ReportFailure,
  runScheduledReport,
} from "@/lib/automations/reports";
import { REPORT_KINDS } from "@/lib/automations/reports";
import { safeLocalMoment, WEEKDAYS } from "@/lib/automations/schedule";
import { db } from "@/lib/db/client";
import { scheduledReports } from "@/lib/db/schema/automations";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { getSetting } from "@/lib/settings";

// ── Scheduled reports: CRUD ───────────────────────────────────────────
//
// Gated on `settings.update`, like every other operator-wide configuration
// surface. Deliberately NOT a new permission: a schedule decides who receives
// company reporting, which is the same blast radius as the settings it sits
// beside, and a new permission constant would need a migration to grant plus
// a scoped case in can() to avoid the switch's `default: return true`.
//
// Re-auth is required to CHANGE a schedule (adding a recipient is how company
// data would leave the building) but not to pause one or send a test. Pausing
// is reversible and removes access; a test sends only to recipients someone
// already approved.

export type ScheduledReportResult =
  | { ok: true }
  | { ok: false; error: string; reauthRequired?: true };

const WEEKDAY = z.enum(WEEKDAYS);

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  report: z.enum(REPORT_KINDS),
  rangeDays: z.number().int().min(1).max(365),
  format: z.enum(["xlsx", "csv", "pdf"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekdays: z.array(WEEKDAY).min(1).max(7),
  recipientUserIds: z.array(z.string().uuid()).max(50),
  recipientRoles: z.array(z.string().trim().min(1).max(80)).max(20),
  recipientEmails: z
    .array(z.string().trim().toLowerCase().email())
    .max(50),
});

export type ScheduledReportInput = z.input<typeof upsertSchema>;

async function requireOperator() {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "settings.update",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  return caller;
}

function hasAnyRecipient(v: z.output<typeof upsertSchema>): boolean {
  return (
    v.recipientUserIds.length + v.recipientRoles.length + v.recipientEmails.length >
    0
  );
}

export async function createScheduledReport(
  input: ScheduledReportInput,
): Promise<ScheduledReportResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) return reauthRequiredResult();

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  if (!hasAnyRecipient(parsed.data)) {
    return { ok: false, error: "Add at least one recipient." };
  }

  const [row] = await db
    .insert(scheduledReports)
    .values({ ...parsed.data, createdById: caller.id })
    .returning({ id: scheduledReports.id });

  await audit({
    actorId: caller.id,
    action: "automation.scheduled_report_create",
    targetType: "scheduled_report",
    targetId: row?.id ?? "unknown",
    after: parsed.data,
  });

  revalidatePath("/admin/automations");
  return { ok: true };
}

export async function updateScheduledReport(
  id: string,
  input: ScheduledReportInput,
): Promise<ScheduledReportResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) return reauthRequiredResult();

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  if (!hasAnyRecipient(parsed.data)) {
    return { ok: false, error: "Add at least one recipient." };
  }

  const [before] = await db
    .select()
    .from(scheduledReports)
    .where(eq(scheduledReports.id, id))
    .limit(1);
  if (!before) throw new NotFoundError();

  await db
    .update(scheduledReports)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(scheduledReports.id, id));

  await audit({
    actorId: caller.id,
    action: "automation.scheduled_report_update",
    targetType: "scheduled_report",
    targetId: id,
    before: {
      name: before.name,
      hour: before.hour,
      minute: before.minute,
      weekdays: before.weekdays,
      recipientUserIds: before.recipientUserIds,
      recipientRoles: before.recipientRoles,
      recipientEmails: before.recipientEmails,
    },
    after: parsed.data,
  });

  revalidatePath("/admin/automations");
  return { ok: true };
}

/** Pause or resume. No re-auth: it is reversible and only ever removes mail. */
export async function setScheduledReportEnabled(
  id: string,
  enabled: boolean,
): Promise<ScheduledReportResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const updated = await db
    .update(scheduledReports)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(scheduledReports.id, id))
    .returning({ id: scheduledReports.id, name: scheduledReports.name });
  if (updated.length === 0) throw new NotFoundError();

  await audit({
    actorId: caller.id,
    action: enabled
      ? "automation.scheduled_report_enable"
      : "automation.scheduled_report_disable",
    targetType: "scheduled_report",
    targetId: id,
    after: { name: updated[0]?.name, enabled },
  });

  revalidatePath("/admin/automations");
  return { ok: true };
}

export async function deleteScheduledReport(
  id: string,
): Promise<ScheduledReportResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) return reauthRequiredResult();
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const deleted = await db
    .delete(scheduledReports)
    .where(eq(scheduledReports.id, id))
    .returning();
  if (deleted.length === 0) throw new NotFoundError();

  await audit({
    actorId: caller.id,
    action: "automation.scheduled_report_delete",
    targetType: "scheduled_report",
    targetId: id,
    before: { name: deleted[0]?.name },
  });

  revalidatePath("/admin/automations");
  return { ok: true };
}

export type SendNowResult =
  | {
      ok: true;
      delivered: number;
      recipients: number;
      failed: ReportFailure[];
    }
  | { ok: false; error: string };

/**
 * Send one report immediately, to its configured recipients.
 *
 * This is the only way to find out whether a schedule actually works without
 * waiting until 19:00, which is why it exists — but it sends REAL email, so it
 * is rate-limited and audited like any other send.
 *
 * It deliberately does NOT set `last_run_on`: a test at 15:00 must not cancel
 * the real 19:00 delivery.
 */
export async function sendScheduledReportNow(
  id: string,
): Promise<SendNowResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const [report] = await db
    .select()
    .from(scheduledReports)
    .where(eq(scheduledReports.id, id))
    .limit(1);
  if (!report) throw new NotFoundError();

  const tz = await getSetting<string>("business_hours.timezone");
  const now = new Date();
  const local = safeLocalMoment(
    now,
    typeof tz === "string" && tz.trim() ? tz : "UTC",
  );

  try {
    const res = await runScheduledReport({
      report,
      now,
      forDate: local.date,
    });

    await audit({
      actorId: caller.id,
      action: "automation.scheduled_report_test",
      targetType: "scheduled_report",
      targetId: id,
      after: {
        name: report.name,
        recipients: res.recipients,
        delivered: res.delivered,
        failed: res.failed,
      },
    });

    if (res.skipped === "no-recipients") {
      return {
        ok: false,
        error:
          "Nobody to send to — every recipient is either removed or a deactivated account.",
      };
    }

    revalidatePath("/admin/automations");
    return {
      ok: true,
      delivered: res.delivered,
      recipients: res.recipients,
      failed: res.failed,
    };
  } catch (err) {
    console.error("[scheduled-reports] test send failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  }
}

export type ScheduledReportListRow = typeof scheduledReports.$inferSelect;

export async function listScheduledReports(): Promise<
  ScheduledReportListRow[]
> {
  await requireOperator();
  return db
    .select()
    .from(scheduledReports)
    .orderBy(desc(scheduledReports.createdAt));
}
