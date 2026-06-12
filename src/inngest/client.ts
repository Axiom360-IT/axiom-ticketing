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

  // ── Billing (M8 — support plans, hours, accountant alerts) ────────
  //
  // Emitted (post-commit) whenever an organization's Monthly-Plan balance may
  // have changed — a work-log deduction, an admin top-up, or the monthly
  // reset. The balance monitor re-reads the committed balance and sends the
  // accountant negative-balance alert (req 8.6), de-duped so each negative
  // episode alerts exactly once.
  "billing/balance.changed": {
    data: { organizationId: string };
  };
  // Emitted when a ticket is resolved, so the accountant gets the billing
  // outcome email (req 8.9).
  "billing/ticket.resolved": {
    data: { ticketId: string };
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
  // ── Customer-facing (delivered to the ticket owner) ──
  // When a tech is assigned, the customer and the technician each get a
  // SEPARATE event type — never the same one. The in-app registry is keyed
  // by event type, so a shared type would render the tech-oriented
  // "assigned to you" wording in the customer's bell (req 6.1). The customer
  // gets `ticket.assigned_customer` (neutral wording naming the technician,
  // req 6.2); the technician gets `ticket.assigned`. Each side toggles its
  // own `notification_preferences` row independently.
  | "ticket.assigned_customer"
  | "ticket.agent_replied"
  | "ticket.resolved"
  | "ticket.reopened"
  | "ticket.closed"
  // ── Staff-facing ──
  // A brand-new ticket arrived from a customer (portal, guest web form, or
  // inbound email). Broadcast to Coordinators + IT Directors + Super Admins so
  // it gets triaged/assigned instead of sitting unseen in the queue.
  | "ticket.created"
  // Delivered to the newly-assigned technician ("Ticket … assigned to you").
  | "ticket.assigned"
  // Fired only on a TRUE reassignment (the ticket already had a different
  // technician). Broadcast to all Super Admins on every channel (req 3.2).
  | "ticket.reassigned"
  // An inbound email reply from a sender outside the ticket's organization was
  // held for moderation (req 5.2). In-app only — routed to Coordinators.
  | "ticket.message_held"
  | "ticket.customer_replied"
  | "ticket.escalated"
  | "ticket.csat_unsatisfied"
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
