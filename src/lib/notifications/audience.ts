import type { NotificationEventType } from "@/inngest/client";

// ── Role-based notification matrix (req 6.4) ─────────────────────────
//
// Notifications are scoped by audience so each role only sees, and only
// tunes preferences for, the events appropriate to it. This module is the
// single source of truth for that mapping; it is a plain (non-"use server",
// non-server-only) module so both the server actions and the client prefs
// grids can import it.
//
// Channels per event are decided at the dispatch site (which of email / SMS /
// in-app it populates) and the dispatcher gates email/SMS by the user's
// `notification_preferences`; in-app is always inserted when the event has a
// registry descriptor. The lists below describe which audience may TUNE each
// event in their profile — they line up 1:1 with the i18n label blocks:
//   STAFF    → profile.preferences.events.*
//   CUSTOMER → portal.profile.notifications.events.*
//
// Keep these in sync with src/lib/notifications/registry.ts and every
// notification/dispatch producer. The full per-role delivery matrix is
// documented in docs/notification-matrix.md.

/**
 * Staff-tunable events (Technician / Coordinator / IT Director / Super Admin).
 * `ticket.assigned` here is the TECHNICIAN copy ("assigned to you"); the
 * customer's assignment event is `ticket.assigned_customer` below.
 */
export const STAFF_EVENT_TYPES = [
  "ticket.assigned",
  "ticket.reassigned",
  "ticket.customer_replied",
  "ticket.csat_unsatisfied",
  "ticket.escalated",
  "sla.warning_50",
  "sla.warning_80",
  "sla.breached",
  "procurement.submitted",
  "procurement.approved",
  "procurement.rejected",
  "procurement.delivered",
  "attachment.quarantined",
] as const satisfies readonly NotificationEventType[];

/**
 * Customer-tunable events (ticket owner). Every entry is written for the
 * customer's point of view — none of the staff-oriented wording (req 6.2).
 */
export const CUSTOMER_EVENT_TYPES = [
  "ticket.assigned_customer",
  "ticket.agent_replied",
  "ticket.resolved",
  "ticket.reopened",
  "ticket.closed",
] as const satisfies readonly NotificationEventType[];

/** Union — the set a user is permitted to write a preference for. */
export const TOGGLEABLE_EVENT_TYPES: ReadonlySet<NotificationEventType> =
  new Set<NotificationEventType>([
    ...STAFF_EVENT_TYPES,
    ...CUSTOMER_EVENT_TYPES,
  ]);
