import type { Events, NotificationDispatchPayload } from "@/inngest/client";
import type { notifications } from "@/lib/db/schema/notifications";
import { inAppDescriptor } from "./registry";

// Pure "who gets what" logic for one notification, with no database and no
// network. It is shared by the in-process sender (deliver.ts) and the Inngest
// dispatcher (the fallback), so both make exactly the same decisions, and it
// is unit-tested on its own.

export type Recipient = {
  id: string;
  email: string | null;
  phone: string | null;
  language: string;
};

export type PreferenceRow = {
  userId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
};

export type EmailChild = Events["notification/email"]["data"];
export type SmsChild = Events["notification/sms"]["data"];
export type InAppRow = typeof notifications.$inferInsert;

export type PlannedDelivery = {
  emails: EmailChild[];
  sms: SmsChild[];
  inApp: InAppRow[];
  /** Recipients that were considered (used for the "dispatched" count). */
  dispatched: number;
};

/**
 * What the recipient's ORGANIZATION allows for this event, per channel
 * (organization_notification_settings). `false` = muted for that org. It can
 * only switch a channel off, never on: a person's own preference still applies.
 * Absent means no organization applies or nothing is muted.
 */
export type OrgChannelAllowance = {
  email: boolean;
  sms: boolean;
  inApp: boolean;
};

export type PlanInput = {
  data: NotificationDispatchPayload;
  recipients: Recipient[];
  preferences: PreferenceRow[];
  /** Ids of recipients who hold the Customer role. */
  customerIds: ReadonlySet<string>;
  /** The global customer-SMS switch (settings: customer_sms.enabled). */
  customerSmsEnabled: boolean;
  orgAllowance?: OrgChannelAllowance;
};

export function planDelivery(input: PlanInput): PlannedDelivery {
  const {
    data,
    recipients,
    preferences,
    customerIds,
    customerSmsEnabled,
    orgAllowance,
  } = input;

  const prefs = new Map<string, PreferenceRow>();
  for (const p of preferences) prefs.set(p.userId, p);

  const descriptor = inAppDescriptor(data.type);

  const plan: PlannedDelivery = {
    emails: [],
    sms: [],
    inApp: [],
    dispatched: 0,
  };

  for (const r of recipients) {
    const pref = prefs.get(r.id);
    const isCustomer = customerIds.has(r.id);

    // Defaults: email + in-app on (matches schema defaults). SMS defaults on
    // too EXCEPT for a customer who has never touched their preference —
    // see updateNotificationPreference's insert defaults, which mirror this
    // (opt-in, not opt-out, for that one case).
    // The organization's mutes apply on top of the person's own choice.
    const emailOn = (pref?.emailEnabled ?? true) && (orgAllowance?.email ?? true);
    const smsOn =
      (pref?.smsEnabled ?? !isCustomer) && (orgAllowance?.sms ?? true);
    const inAppOn = (pref?.inAppEnabled ?? true) && (orgAllowance?.inApp ?? true);
    // Customers only: the global switch overrides their own preference
    // entirely when off. Staff SMS is never affected by this setting.
    const smsAllowed = !isCustomer || customerSmsEnabled;

    if (data.email && emailOn && r.email) {
      plan.emails.push({
        to: r.email,
        locale: r.language,
        template: data.email.template,
        ticketNumber: data.email.ticketNumber,
        replyToTicket: data.email.replyToTicket,
      });
    }

    if (data.sms && smsOn && smsAllowed && r.phone) {
      plan.sms.push({
        to: r.phone,
        locale: r.language,
        template: data.sms.template,
      });
    }

    if (descriptor && inAppOn) {
      plan.inApp.push({
        userId: r.id,
        eventType: data.type,
        titleKey: descriptor.titleKey,
        titleArgs: data.inApp?.titleArgs ?? null,
        bodyKey: descriptor.bodyKey,
        bodyArgs: data.inApp?.bodyArgs ?? null,
        linkUrl: data.inApp?.linkUrl ?? null,
      });
    }
    plan.dispatched++;
  }

  return plan;
}
