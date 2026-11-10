import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { inngest, type NotificationDispatchPayload } from "@/inngest/client";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { failedNotifications } from "@/lib/db/schema/failed-notifications";
import {
  notificationPreferences,
  notifications,
} from "@/lib/db/schema/notifications";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { organizationNotificationSettings } from "@/lib/db/schema/organization-notification-settings";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { sendSms } from "@/lib/sms/send";
import { getSetting } from "@/lib/settings";
import { TOGGLEABLE_EVENT_TYPES } from "./audience";
import { mapLimit } from "./map-limit";
import { isPermanentSendFailure } from "./permanent-failure";
import {
  type EmailChild,
  type OrgChannelAllowance,
  planDelivery,
  type PlannedDelivery,
  type PreferenceRow,
  type Recipient,
  type SmsChild,
} from "./plan";

// Sends a notification (bell + email + SMS) from INSIDE the request that
// caused it, with no dependency on Inngest being healthy.
//
// Why: staff and customer notifications used to be an Inngest event
// (`notification/dispatch` -> fan-out -> `notification/email`/`/sms`). Inngest
// is metered, and when the Hobby allowance ran out on 2026-11-08 it kept
// ACCEPTING those events while running none of them — so technicians got no
// "ticket assigned to you" or "customer replied" email, and nothing said so.
// Sending is now done here; Inngest is only the safety net (see
// `emitNotification`).
//
// Inngest still gave one useful thing — a retry per recipient — so `sendWithRetry`
// reproduces it: three tries with backoff, except for failures that cannot
// change between attempts (bad key, exhausted quota, invalid recipient).

const CUSTOMER_ROLE_NAME = "Customer";

// Provider rate limits are per second; keep a staff alert (~7 recipients) well
// under them instead of firing every send in the same instant.
const EMAIL_CONCURRENCY = 3;
const SMS_CONCURRENCY = 3;

const BACKOFF_MS = [500, 1500];
const ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Reads (shared with the Inngest fallback dispatcher) ──────────────────

/** Resolve explicit ids + role names to active users. */
export async function resolveRecipients(
  data: NotificationDispatchPayload,
): Promise<Recipient[]> {
  const userIds = new Set<string>(data.recipientUserIds ?? []);

  if (data.recipientRoles && data.recipientRoles.length > 0) {
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          inArray(roles.name, data.recipientRoles),
          eq(users.isActive, true),
        ),
      );
    for (const r of rows) userIds.add(r.id);
  }

  if (userIds.size === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      language: users.language,
    })
    .from(users)
    .where(and(inArray(users.id, [...userIds]), eq(users.isActive, true)));

  return rows;
}

export type PlanContext = {
  preferences: PreferenceRow[];
  customerIds: string[];
  customerSmsEnabled: boolean;
  orgAllowance?: OrgChannelAllowance;
};

/**
 * What the organization this notification is about allows, per channel.
 *
 * The organization is the one that owns the ticket the notification is about
 * (found by ticket id, else ticket number). Notifications with no ticket, and
 * event types an admin cannot mute (an automation rule's notification is the
 * operator's explicit instruction), are never affected.
 *
 * FAILS OPEN. Any problem here (table not migrated yet, database hiccup) means
 * "nothing is muted": an extra notification is a nuisance, a silently missing
 * one is the failure this whole module exists to prevent.
 */
export async function loadOrgAllowance(
  data: NotificationDispatchPayload,
): Promise<OrgChannelAllowance | undefined> {
  if (!TOGGLEABLE_EVENT_TYPES.has(data.type)) return undefined;
  const ticketNumber = data.ticketNumber ?? data.email?.ticketNumber;
  if (!data.ticketId && !ticketNumber) return undefined;
  try {
    const [t] = await db
      .select({ organizationId: tickets.organizationId })
      .from(tickets)
      .where(
        data.ticketId
          ? eq(tickets.id, data.ticketId)
          : eq(tickets.ticketNumber, ticketNumber as string),
      )
      .limit(1);
    if (!t?.organizationId) return undefined;

    const [row] = await db
      .select({
        email: organizationNotificationSettings.emailEnabled,
        sms: organizationNotificationSettings.smsEnabled,
        inApp: organizationNotificationSettings.inAppEnabled,
      })
      .from(organizationNotificationSettings)
      .where(
        and(
          eq(organizationNotificationSettings.organizationId, t.organizationId),
          eq(organizationNotificationSettings.eventType, data.type),
        ),
      )
      .limit(1);
    return row;
  } catch (err) {
    console.warn("[notifications] org mute lookup failed; treating as none", {
      type: data.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Everything `planDelivery` needs besides the payload and the recipients. */
export async function loadPlanContext(
  data: NotificationDispatchPayload,
  recipients: Recipient[],
): Promise<PlanContext> {
  const ids = recipients.map((r) => r.id);
  const [preferences, customerRows, smsSetting, orgAllowance] =
    await Promise.all([
    db
      .select({
        userId: notificationPreferences.userId,
        emailEnabled: notificationPreferences.emailEnabled,
        smsEnabled: notificationPreferences.smsEnabled,
        inAppEnabled: notificationPreferences.inAppEnabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, ids),
          eq(notificationPreferences.eventType, data.type),
        ),
      ),
    db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          inArray(userRoles.userId, ids),
          eq(roles.name, CUSTOMER_ROLE_NAME),
        ),
      ),
    getSetting<boolean>("customer_sms.enabled"),
    loadOrgAllowance(data),
  ]);
  return {
    preferences,
    customerIds: customerRows.map((r) => r.userId),
    customerSmsEnabled: smsSetting ?? true,
    orgAllowance,
  };
}

// ── Sends ────────────────────────────────────────────────────────────────

async function sendWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Retrying cannot help a rejected key, an exhausted quota or a bad
      // address; stop and report it once.
      if (isPermanentSendFailure(err)) break;
      if (attempt < ATTEMPTS - 1) await sleep(BACKOFF_MS[attempt] ?? 1200);
    }
  }
  throw lastError;
}

async function recordFailure(args: {
  channel: "email" | "sms";
  eventType: string;
  recipient: string;
  payload: unknown;
  error: unknown;
  startedAt: Date;
}): Promise<void> {
  try {
    await db.insert(failedNotifications).values({
      inngestEventId: `direct:${crypto.randomUUID()}`,
      channel: args.channel,
      eventType: args.eventType,
      recipient: args.recipient,
      payload: args.payload,
      errorMessage:
        args.error instanceof Error ? args.error.message : String(args.error),
      retryCount: ATTEMPTS - 1,
      firstAttemptAt: args.startedAt,
      lastAttemptAt: new Date(),
    });
  } catch (err) {
    // The log line below is the fallback record.
    console.error("[notifications] could not record failed send", err);
  }
}

async function sendEmailChild(
  child: EmailChild,
  eventType: string,
): Promise<boolean> {
  const startedAt = new Date();
  try {
    await sendWithRetry(() =>
      sendEmail({
        to: child.to,
        locale: child.locale,
        template: child.template,
        ticketNumber: child.ticketNumber,
        replyToTicket: child.replyToTicket,
      }),
    );
    return true;
  } catch (error) {
    console.error("[notifications] email failed", {
      eventType,
      to: child.to,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordFailure({
      channel: "email",
      eventType,
      recipient: child.to,
      payload: { template: child.template.template, ticketNumber: child.ticketNumber },
      error,
      startedAt,
    });
    return false;
  }
}

async function sendSmsChild(
  child: SmsChild,
  eventType: string,
): Promise<boolean> {
  const startedAt = new Date();
  try {
    await sendWithRetry(() =>
      sendSms({ to: child.to, locale: child.locale, template: child.template }),
    );
    return true;
  } catch (error) {
    console.error("[notifications] sms failed", {
      eventType,
      to: child.to,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordFailure({
      channel: "sms",
      eventType,
      recipient: child.to,
      payload: { template: child.template.template },
      error,
      startedAt,
    });
    return false;
  }
}

export type DeliveryResult = {
  via: "direct" | "inngest";
  recipients: number;
  dispatched: number;
  emailsSent: number;
  emailsFailed: number;
  smsSent: number;
  smsFailed: number;
};

/** Deliver an already-planned notification. Never throws. */
export async function executePlan(
  plan: PlannedDelivery,
  eventType: string,
): Promise<Omit<DeliveryResult, "via" | "recipients">> {
  // Bell, email and SMS go out together: they are independent of each other,
  // and a slow or failing provider must not hold up the bell.
  const [, emailOk, smsOk] = await Promise.all([
    plan.inApp.length > 0
      ? db
          .insert(notifications)
          .values(plan.inApp)
          .catch((err) =>
            console.error("[notifications] in-app insert failed", err),
          )
      : Promise.resolve(),
    mapLimit(plan.emails, EMAIL_CONCURRENCY, (e) => sendEmailChild(e, eventType)),
    mapLimit(plan.sms, SMS_CONCURRENCY, (m) => sendSmsChild(m, eventType)),
  ]);
  return {
    dispatched: plan.dispatched,
    emailsSent: emailOk.filter(Boolean).length,
    emailsFailed: emailOk.filter((ok) => !ok).length,
    smsSent: smsOk.filter(Boolean).length,
    smsFailed: smsOk.filter((ok) => !ok).length,
  };
}

/**
 * The one entry point producers call. Replaces
 * `inngest.send({ name: "notification/dispatch", data })`.
 *
 * Resolves recipients and preferences, then sends bell + email + SMS right
 * here. If the READ phase fails (database hiccup) nothing has been sent yet,
 * so it hands the whole event to Inngest as before — a replay then cannot
 * duplicate anything. A failure of an individual email/SMS is retried and, if
 * it still fails, recorded in `failed_notifications`; it is never replayed,
 * because the other recipients' copies have already gone out.
 */
export async function emitNotification(
  data: NotificationDispatchPayload,
): Promise<DeliveryResult> {
  let plan: PlannedDelivery;
  let recipientCount: number;
  try {
    const recipients = await resolveRecipients(data);
    recipientCount = recipients.length;
    if (recipients.length === 0) {
      return {
        via: "direct",
        recipients: 0,
        dispatched: 0,
        emailsSent: 0,
        emailsFailed: 0,
        smsSent: 0,
        smsFailed: 0,
      };
    }
    const ctx = await loadPlanContext(data, recipients);
    plan = planDelivery({
      data,
      recipients,
      preferences: ctx.preferences,
      customerIds: new Set(ctx.customerIds),
      customerSmsEnabled: ctx.customerSmsEnabled,
      orgAllowance: ctx.orgAllowance,
    });
  } catch (err) {
    console.error(
      "[notifications] could not plan delivery; handing to Inngest",
      { type: data.type, error: err instanceof Error ? err.message : String(err) },
    );
    await inngest.send({ name: "notification/dispatch", data });
    return {
      via: "inngest",
      recipients: 0,
      dispatched: 0,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
    };
  }

  const done = await executePlan(plan, data.type);
  return { via: "direct", recipients: recipientCount, ...done };
}

/**
 * Send one email to an address with no account behind it (an automation rule's
 * "loose" recipient). Replaces `inngest.send({ name: "notification/email" })`.
 */
export async function emitEmail(
  child: EmailChild,
  eventType: string,
): Promise<boolean> {
  return sendEmailChild(child, eventType);
}
