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
  "ticket.created",
  "ticket.closed_staff",
  "ticket.unassigned_reminder",
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

// ── Per-role scoping of the staff set (req 6.4) ──────────────────────
//
// STAFF_EVENT_TYPES above is the FULL staff catalogue. A given staff member
// should only see — and tune — the events their role actually receives, so a
// Technician isn't shown triage/oversight toggles for notifications that only
// ever route to Coordinators/Directors/Super Admins (and vice versa).
//
// Split into two tiers:
//   BASE       — events ANY staff member can receive: as the assignee of a
//                ticket (assignment, customer reply, CSAT, SLA, quarantine) or
//                as the requester of a procurement (approved/rejected/delivered).
//   MANAGEMENT — triage/oversight events that route ONLY to the management
//                roles (new ticket, closed, unassigned nudge, reassignment,
//                escalation, procurement to approve).
// BASE ∪ MANAGEMENT == STAFF_EVENT_TYPES exactly.

const BASE_STAFF_EVENT_TYPES = [
  "ticket.assigned",
  "ticket.customer_replied",
  "ticket.csat_unsatisfied",
  "sla.warning_50",
  "sla.warning_80",
  "sla.breached",
  "attachment.quarantined",
  "procurement.approved",
  "procurement.rejected",
  "procurement.delivered",
] as const satisfies readonly NotificationEventType[];

const MANAGEMENT_EVENT_TYPES = [
  "ticket.created",
  "ticket.closed_staff",
  "ticket.unassigned_reminder",
  "ticket.reassigned",
  "ticket.escalated",
  "procurement.submitted",
] as const satisfies readonly NotificationEventType[];

const MANAGEMENT_ROLES = ["Coordinator", "IT Director", "Super Admin"] as const;

/**
 * The staff notification events a user may tune, scoped to their role(s). A
 * user holding any management role additionally sees the triage/oversight
 * events. Erring toward over-inclusion (never hides an event a role might
 * receive); preserves STAFF_EVENT_TYPES ordering for a stable grid (req 6.4).
 */
export function staffEventsForRoles(
  roleNames: Iterable<string>,
): readonly NotificationEventType[] {
  const names = roleNames instanceof Set ? roleNames : new Set(roleNames);
  const allowed = new Set<NotificationEventType>(BASE_STAFF_EVENT_TYPES);
  if (MANAGEMENT_ROLES.some((r) => names.has(r))) {
    for (const e of MANAGEMENT_EVENT_TYPES) allowed.add(e);
  }
  return STAFF_EVENT_TYPES.filter((e) => allowed.has(e));
}

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
