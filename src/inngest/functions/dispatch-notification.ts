import { and, eq, inArray } from "drizzle-orm";
import { eventType } from "inngest";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { notificationPreferences } from "@/lib/db/schema/notifications";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { inAppDescriptor } from "@/lib/notifications/registry";
import { inngest } from "../client";

// Dispatcher: producer fires one `notification/dispatch`; we read prefs
// and emit per-recipient child events. The actual sending lives in
// send-email-notification, send-sms-notification,
// send-in-app-notification — each independently retried.

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
    const prefRows = await step.run("load-preferences", async () =>
      db
        .select({
          userId: notificationPreferences.userId,
          emailEnabled: notificationPreferences.emailEnabled,
          smsEnabled: notificationPreferences.smsEnabled,
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
    );
    const prefs = new Map<
      string,
      { emailEnabled: boolean; smsEnabled: boolean }
    >();
    for (const r of prefRows) {
      prefs.set(r.userId, {
        emailEnabled: r.emailEnabled,
        smsEnabled: r.smsEnabled,
      });
    }

    const descriptor = inAppDescriptor(data.type);

    let dispatched = 0;
    for (const r of recipients) {
      const pref = prefs.get(r.id);
      // Defaults: email + sms both on (matches schema defaults).
      const emailOn = pref?.emailEnabled ?? true;
      const smsOn = pref?.smsEnabled ?? true;

      if (data.email && emailOn && r.email) {
        await step.sendEvent(`email-${r.id}`, {
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

      if (data.sms && smsOn && r.phone) {
        await step.sendEvent(`sms-${r.id}`, {
          name: "notification/sms",
          data: {
            to: r.phone,
            locale: r.language,
            template: data.sms.template,
          },
        });
      }

      if (descriptor) {
        await step.sendEvent(`inapp-${r.id}`, {
          name: "notification/in-app",
          data: {
            userId: r.id,
            eventType: data.type,
            titleKey: descriptor.titleKey,
            titleArgs: data.inApp?.titleArgs,
            bodyKey: descriptor.bodyKey,
            bodyArgs: data.inApp?.bodyArgs,
            linkUrl: data.inApp?.linkUrl,
          },
        });
      }
      dispatched++;
    }

    return { recipients: recipients.length, dispatched };
  },
);
