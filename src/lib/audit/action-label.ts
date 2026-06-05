// Human-readable labels for raw audit action codes, plus a field-key
// humanizer for the audit detail view. The app ships English-only (single
// messages file), so these live in code rather than i18n — and they're plain
// strings used through helpers, not JSX literals.

const ACTION_LABELS: Record<string, string> = {
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
  "ticket.set_billable": "Set the billable category",
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
