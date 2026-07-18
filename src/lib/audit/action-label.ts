// Human-readable labels for raw audit action codes, plus a field-key
// humanizer for the audit detail view. The app ships English-only (single
// messages file), so these live in code rather than i18n — and they're plain
// strings used through helpers, not JSX literals.

const ACTION_LABELS: Record<string, string> = {
  // Audit
  "audit.export": "Exported the audit log",
  // Attachments
  "attachment.confirm": "Attachment confirmed",
  "attachment.scan": "Attachment scanned",
  "attachment.quarantine": "Attachment quarantined",
  // Customer / account
  "customer.claim_tickets": "Linked guest tickets to account",
  // Holidays
  "holiday.upsert": "Added or updated a holiday",
  "holiday.remove": "Removed a holiday",
  // Organizations
  "organization.create": "Created an organization",
  "organization.update": "Updated an organization",
  "organization.delete": "Deleted an organization",
  "organization.add_hours": "Added plan hours",
  "organization.untrust_contact": "Revoked a trusted contact",
  // Procurement
  "procurement.create": "Created a procurement request",
  "procurement.approve": "Approved a procurement request",
  "procurement.set_status": "Changed a procurement status",
  // Roles
  "role.create": "Created a role",
  "role.update": "Updated a role",
  "role.delete": "Deleted a role",
  // Sessions
  "session.revoke": "Revoked a session",
  "session.revoke_others": "Signed out other sessions",
  // Settings
  "settings.update": "Updated settings",
  "setting.update": "Updated a setting",
  // Tickets
  "ticket.create": "Created a ticket",
  "ticket.create_on_behalf": "Created a ticket on behalf of a customer",
  "ticket.inbound_email": "Received an inbound email",
  "ticket.assign": "Assigned the ticket",
  "ticket.add_collaborator": "Added a collaborating technician",
  "ticket.remove_collaborator": "Removed a collaborating technician",
  "ticket.reply": "Replied to the customer",
  "ticket.customer_reply": "Customer replied",
  "ticket.internal_note": "Added an internal note",
  "ticket.status_change": "Changed the ticket status",
  "ticket.priority_change": "Changed the priority",
  "ticket.customer_change": "Changed the customer",
  "ticket.set_billable": "Set the billable category",
  "ticket.set_invoice": "Set the invoice number",
  "ticket.log_work": "Logged work",
  "ticket.update_work_log": "Edited a work-log entry",
  "ticket.delete_work_log": "Deleted a work-log entry",
  "ticket.escalate": "Escalated the ticket",
  "ticket.deescalate": "De-escalated the ticket",
  "ticket.resolve": "Resolved the ticket",
  "ticket.reopen": "Reopened the ticket",
  "ticket.auto_close": "Auto-closed the ticket",
  "ticket.merge": "Merged the ticket",
  "ticket.link_organization": "Linked the ticket to an organization",
  "ticket.dismiss_organization": "Marked the ticket as having no organization",
  "ticket.moderate_message": "Moderated a held inbound message",
  "ticket.delete": "Deleted the ticket",
  "ticket.sla_breach": "SLA breached",
  // Users
  "user.login": "Signed in",
  "user.login_denied": "Sign-in blocked (locked)",
  "user.logout": "Signed out",
  "user.create": "Created a user",
  "user.update": "Updated a user",
  "user.update_profile": "Updated a profile",
  "user.update_avatar": "Updated an avatar",
  "user.remove_avatar": "Removed an avatar",
  "user.update_notification_preference": "Updated notification preferences",
  "user.change_password": "Changed a password",
  "user.set_password": "Set a password",
  "user.reset_password": "Reset a password",
  "user.deactivate": "Deactivated a user",
  "user.reactivate": "Reactivated a user",
  "user.locked": "Account locked (failed sign-ins)",
  "user.unlock": "Unlocked an account",
};

// ── Categories (for row colour/icon + grouping the action filter) ────────

export type AuditCategory =
  | "tickets"
  | "users"
  | "security"
  | "billing"
  | "config"
  | "system";

export const AUDIT_CATEGORY_ORDER: AuditCategory[] = [
  "tickets",
  "users",
  "security",
  "billing",
  "config",
  "system",
];

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  tickets: "Tickets",
  users: "Users",
  security: "Security & access",
  billing: "Billing",
  config: "Configuration",
  system: "System",
};

// Explicit overrides where the domain prefix alone would mis-categorise.
const SECURITY_ACTIONS = new Set([
  "user.login",
  "user.login_denied",
  "user.logout",
  "user.change_password",
  "user.set_password",
  "user.reset_password",
  "user.deactivate",
  "user.reactivate",
  "user.locked",
  "user.unlock",
  "organization.untrust_contact",
]);
const BILLING_ACTIONS = new Set([
  "ticket.set_billable",
  "ticket.set_invoice",
  "organization.add_hours",
  "procurement.create",
  "procurement.approve",
  "procurement.set_status",
]);
const CONFIG_ACTIONS = new Set([
  "settings.update",
  "setting.update",
  "holiday.upsert",
  "holiday.remove",
  "organization.create",
  "organization.update",
  "organization.delete",
  "ticket.link_organization",
  "ticket.dismiss_organization",
]);
const SYSTEM_ACTIONS = new Set([
  "attachment.confirm",
  "attachment.scan",
  "attachment.quarantine",
  "ticket.inbound_email",
  "ticket.auto_close",
  "ticket.sla_breach",
  "ticket.customer_reply",
  "customer.claim_tickets",
]);

/** Bucket a raw action code into a display category. */
export function auditActionCategory(code: string): AuditCategory {
  if (SECURITY_ACTIONS.has(code)) return "security";
  if (BILLING_ACTIONS.has(code)) return "billing";
  if (CONFIG_ACTIONS.has(code)) return "config";
  if (SYSTEM_ACTIONS.has(code)) return "system";
  if (
    code.startsWith("role.") ||
    code.startsWith("session.") ||
    code.startsWith("audit.")
  )
    return "security";
  if (code.startsWith("user.")) return "users";
  if (code.startsWith("organization.") || code.startsWith("procurement."))
    return "config";
  if (code.startsWith("ticket.")) return "tickets";
  return "system";
}

/** Destructive/irreversible actions — surfaced in red regardless of category. */
export function isDestructiveAction(code: string): boolean {
  return (
    /\.(delete|delete_work_log|deactivate|remove|remove_collaborator|quarantine|revoke|revoke_others|untrust_contact)$/.test(
      code,
    ) || code === "ticket.delete"
  );
}

export type AuditOutcome = "success" | "failure" | "denied" | "error";
export type AuditSeverity = "info" | "notice" | "warning" | "critical";

/** Derive a display severity from the action + its outcome (denormalized at
 *  write time). Failures/denials and destructive actions warrant attention;
 *  security-category successes are a notch above routine. */
export function auditSeverity(
  code: string,
  outcome: AuditOutcome = "success",
): AuditSeverity {
  if (outcome !== "success") return "warning";
  if (isDestructiveAction(code)) return "warning";
  if (auditActionCategory(code) === "security") return "notice";
  return "info";
}

/** "ticket.internal_note" → "Internal note" (fallback when unmapped). */
function prettifyCode(code: string): string {
  const tail = code.includes(".") ? code.slice(code.indexOf(".") + 1) : code;
  const spaced = tail.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Friendly, human-readable label for a raw audit action code. */
export function auditActionLabel(code: string): string {
  return ACTION_LABELS[code] ?? prettifyCode(code);
}

/** "assignedToId" / "service_type" → "Assigned to id" / "Service type". A few
 *  high-traffic keys get nicer overrides. */
const FIELD_OVERRIDES: Record<string, string> = {
  note: "Note",
  reply: "Reply",
  body: "Message",
  assignedToId: "Assigned to",
  organizationId: "Organization",
  organizationName: "Organization",
  serviceType: "Service type",
  minutes: "Minutes",
  billable: "Billable",
  status: "Status",
  reason: "Reason",
  ticketNumber: "Ticket",
  collaboratorId: "Collaborator",
};

export function humanizeFieldKey(key: string): string {
  if (FIELD_OVERRIDES[key]) return FIELD_OVERRIDES[key];
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Outcome + target humanizers (shared by the audit UI and the export) ──────

const OUTCOME_LABELS: Record<string, string> = {
  success: "Success",
  failure: "Failed",
  denied: "Denied",
  error: "Error",
};

/** "denied" → "Denied". Null/empty is treated as a success (the default). */
export function auditOutcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "Success";
  return OUTCOME_LABELS[outcome] ?? prettifyCode(outcome);
}

/** A readable "what was affected" string — e.g. "Ticket AX-20260717-001",
 *  "Organization", or "Audit log". Prefers the stored human label, then falls
 *  back to a humanized target type + id. */
export function friendlyAuditTarget(t: {
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
}): string {
  if (t.targetLabel && t.targetLabel.trim().length > 0) return t.targetLabel;
  const type = t.targetType ? humanizeFieldKey(t.targetType) : null;
  if (type && t.targetId) return `${type} ${t.targetId}`;
  return type ?? t.targetId ?? "—";
}
