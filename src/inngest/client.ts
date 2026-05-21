import { Inngest } from "inngest";
import type { EmailTemplate } from "@/lib/email/send";
import type { SmsTemplate } from "@/lib/notifications/sms-types";

// Inngest event payloads. Add to this union whenever a new domain event
// is emitted.
export type Events = {
  "ticket/created": {
    data: { ticketId: string; ticketNumber: string };
  };
  "email/inbound.received": {
    data: { payload: unknown; eventId: string };
  };
  "attachment/uploaded": {
    data: { attachmentId: string };
  };

  // ── Notification fan-out (M11) ────────────────────────────────────
  //
  // Producers emit one `notification/dispatch`; the dispatcher reads
  // notification_preferences for each recipient and fans out into
  // `notification/email`, `notification/sms`, and `notification/in-app`.
  // Each sender function is independently retried by Inngest.
  "notification/dispatch": {
    data: NotificationDispatchPayload;
  };
  "notification/email": {
    data: {
      to: string;
      locale: string;
      template: EmailTemplate;
      ticketNumber?: string;
      replyToTicket?: boolean;
    };
  };
  "notification/sms": {
    data: {
      to: string;
      locale: string;
      template: SmsTemplate;
    };
  };
  "notification/in-app": {
    data: {
      userId: string;
      eventType: string;
      titleKey: string;
      titleArgs?: Record<string, string | number>;
      bodyKey: string;
      bodyArgs?: Record<string, string | number>;
      linkUrl?: string;
    };
  };
};

export type NotificationEventType =
  // ── Customer-facing (delivered to ticket owner) ──
  // `ticket.assigned` is overloaded: the SAME event type is used for the
  // customer ("someone's working on your ticket") and the tech ("you've
  // been assigned"). Different dispatch calls with different email
  // templates and different recipient sets; the dispatcher looks up
  // per-user `notification_preferences` so each side toggles their own
  // copy independently.
  | "ticket.assigned"
  | "ticket.agent_replied"
  | "ticket.resolved"
  | "ticket.reopened"
  | "ticket.closed"
  // ── Staff-facing ──
  | "ticket.customer_replied"
  | "ticket.escalated"
  | "sla.warning_50"
  | "sla.warning_80"
  | "sla.breached"
  | "procurement.submitted"
  | "procurement.approved"
  | "procurement.rejected"
  | "procurement.delivered"
  | "attachment.quarantined";

export type NotificationDispatchPayload = {
  /** Domain event being announced. */
  type: NotificationEventType;
  /** Explicit recipient user IDs (deduped against any role-resolved set). */
  recipientUserIds?: string[];
  /** Roles to broadcast to (e.g. ["IT Director", "Coordinator"]). */
  recipientRoles?: string[];
  /**
   * Email template payload. The dispatcher fills in `to` per recipient
   * (using their email column) and `locale` (using their language).
   */
  email?: {
    template: EmailTemplate;
    ticketNumber?: string;
    replyToTicket?: boolean;
  };
  /** SMS template payload. The dispatcher fills in `to` and `locale`. */
  sms?: {
    template: SmsTemplate;
  };
  /** In-app args (referenced by the registry's titleKey/bodyKey). */
  inApp?: {
    titleArgs?: Record<string, string | number>;
    bodyArgs?: Record<string, string | number>;
    linkUrl?: string;
  };
};

export const inngest = new Inngest({
  id: "axiom-ticketing",
  schemas: undefined,
});
