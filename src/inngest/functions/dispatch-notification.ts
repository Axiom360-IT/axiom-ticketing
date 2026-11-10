import { and, eq, inArray } from "drizzle-orm";
import { eventType } from "inngest";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import {
  notificationPreferences,
  notifications,
} from "@/lib/db/schema/notifications";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { inAppDescriptor } from "@/lib/notifications/registry";
import { getSetting } from "@/lib/settings";
import { type Events, inngest } from "../client";

const CUSTOMER_ROLE_NAME = "Customer";

// Dispatcher: producer fires one `notification/dispatch`; we read prefs
// and fan out. Email and SMS legs are emitted as child events handled by
// send-email-notification / send-sms-notification (each independently
// retried). The in-app (bell) rows are inserted right here.
//
// Why this is shaped the way it is: Inngest bills every step and every
// function run as an "execution", and the Hobby plan allows 50k a month.
// This used to call `step.sendEvent` once per recipient per channel — a
// dispatch to 8 staff was ~16 steps, plus one extra run per child event, and
// bell/SMS/email notifications were the single biggest consumer of the plan.
// Now:
//   • all email/SMS child events go out in ONE batched `step.sendEvent`
//     (chunked, only to stay clear of request-size limits), and
//   • all bell rows go in with ONE bulk insert inside ONE `step.run` — so no
//     `notification/in-app` event and no `send-in-app-notification` run per
//     recipient.
// `send-in-app-notification` stays registered: the customer-import job still
// emits `notification/in-app` for its single "import finished" bell.

export const dispatchNotification = inngest.createFunction(
  {
    id: "dispatch-notification",
    triggers: eventType("notification/dispatch"),
  },
  async ({ event, step }) => {
    const data = event.data;
    const recipients = await step.run("resolve-recipients", async () => {
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

      const userRows = await db
        .select({
          id: users.id,
          email: users.email,
          phone: users.phone,
          language: users.language,
          isActive: users.isActive,
        })
        .from(users)
        .where(inArray(users.id, [...userIds]));

      return userRows.filter((u) => u.isActive);
    });

    if (recipients.length === 0) {
      return { recipients: 0, dispatched: 0 };
    }

    // Inngest serializes step results through JSON, so we keep the
    // step body free of Map / Date / Buffer values.
    const [prefRows, customerIds, customerSmsGloballyEnabled] =
      await step.run("load-preferences", async () => {
        const [rows, customerRoleRows, setting] = await Promise.all([
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
                inArray(
                  notificationPreferences.userId,
                  recipients.map((r) => r.id),
                ),
                eq(notificationPreferences.eventType, data.type),
              ),
            ),
          db
            .select({ userId: userRoles.userId })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(
              and(
                inArray(
                  userRoles.userId,
                  recipients.map((r) => r.id),
                ),
                eq(roles.name, CUSTOMER_ROLE_NAME),
              ),
            ),
          getSetting<boolean>("customer_sms.enabled"),
        ]);
        return [
          rows,
          customerRoleRows.map((r) => r.userId),
          setting ?? true,
        ] as const;
      });
    const prefs = new Map<
      string,
      { emailEnabled: boolean; smsEnabled: boolean; inAppEnabled: boolean }
    >();
    for (const r of prefRows) {
      prefs.set(r.userId, {
        emailEnabled: r.emailEnabled,
        smsEnabled: r.smsEnabled,
        inAppEnabled: r.inAppEnabled,
      });
    }
    const customerIdSet = new Set(customerIds);

    const descriptor = inAppDescriptor(data.type);

    // Collect first, send after: the whole point is to pay for ONE step per
    // channel instead of one per recipient.
    const childEvents: Array<
      | { name: "notification/email"; data: Events["notification/email"]["data"] }
      | { name: "notification/sms"; data: Events["notification/sms"]["data"] }
    > = [];
    const inAppRows: Array<typeof notifications.$inferInsert> = [];

    let dispatched = 0;
    for (const r of recipients) {
      const pref = prefs.get(r.id);
      // Defaults: email + in-app on (matches schema defaults). SMS
      // defaults on too EXCEPT for a customer who's never touched their
      // preference — see updateNotificationPreference's insert defaults,
      // which mirror this (opt-in, not opt-out, for that one case).
      const emailOn = pref?.emailEnabled ?? true;
      const smsOn = pref?.smsEnabled ?? !customerIdSet.has(r.id);
      const inAppOn = pref?.inAppEnabled ?? true;
      // Customers only: the global switch overrides their own preference
      // entirely when off. Staff SMS is never affected by this setting.
      const smsAllowedForRecipient =
        !customerIdSet.has(r.id) || customerSmsGloballyEnabled;

      if (data.email && emailOn && r.email) {
        childEvents.push({
          name: "notification/email",
          data: {
            to: r.email,
            locale: r.language,
            template: data.email.template,
            ticketNumber: data.email.ticketNumber,
            replyToTicket: data.email.replyToTicket,
          },
        });
      }

      if (data.sms && smsOn && smsAllowedForRecipient && r.phone) {
        childEvents.push({
          name: "notification/sms",
          data: {
            to: r.phone,
            locale: r.language,
            template: data.sms.template,
          },
        });
      }

      if (descriptor && inAppOn) {
        inAppRows.push({
          userId: r.id,
          eventType: data.type,
          titleKey: descriptor.titleKey,
          titleArgs: data.inApp?.titleArgs ?? null,
          bodyKey: descriptor.bodyKey,
          bodyArgs: data.inApp?.bodyArgs ?? null,
          linkUrl: data.inApp?.linkUrl ?? null,
        });
      }
      dispatched++;
    }

    // Bell rows: one bulk insert, one step. Runs before the email/SMS fan-out
    // so the in-app notification (the leg that never depends on a third-party
    // provider) lands even if a later step has to retry.
    if (inAppRows.length > 0) {
      await step.run("insert-in-app", async () => {
        await db.insert(notifications).values(inAppRows);
      });
    }

    // Email + SMS: batched. 100 per call is far below any request-size limit
    // and, for a normal dispatch (a handful of recipients), is exactly one step.
    const BATCH = 100;
    for (let i = 0; i < childEvents.length; i += BATCH) {
      await step.sendEvent(
        `fan-out-${i / BATCH}`,
        childEvents.slice(i, i + BATCH),
      );
    }

    return { recipients: recipients.length, dispatched };
  },
);
