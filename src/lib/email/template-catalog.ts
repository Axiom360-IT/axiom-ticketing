// Catalog of the email templates whose copy an admin can reword from
// Settings → Email templates. Pure data (no server-only imports) so the client
// editor can use it for grouping/labels too.
//
// `key` is the namespace suffix under `emails.` in src/messages/<locale>.json
// — the same string each template component passes to getTranslations. The
// actual editable FIELD list per template is derived from the message catalog
// at runtime (see lib/email/template-fields.ts), so adding a new key to a
// template's namespace makes it editable automatically, with no list to keep
// in sync here.

export type EmailTemplateGroup =
  | "shared"
  | "customer"
  | "staff"
  | "procurement"
  | "accountant";

export type EmailTemplateEntry = {
  key: string;
  group: EmailTemplateGroup;
};

export const EMAIL_TEMPLATE_CATALOG: EmailTemplateEntry[] = [
  // The shared header/footer chrome wrapped around every email.
  { key: "shared", group: "shared" },

  // Customer-facing.
  { key: "ticketCreated", group: "customer" },
  { key: "ticketAssigned", group: "customer" },
  { key: "ticketReply", group: "customer" },
  { key: "ticketResolved", group: "customer" },
  { key: "ticketClosed", group: "customer" },
  { key: "ticketReopened", group: "customer" },
  { key: "customerFollowup", group: "customer" },
  { key: "inboundBounce", group: "customer" },
  { key: "inboundClosedTicket", group: "customer" },
  { key: "attachmentRemovedCustomer", group: "customer" },
  { key: "customerMagicLink", group: "customer" },
  { key: "customerEmailVerification", group: "customer" },
  { key: "customerWelcome", group: "customer" },
  { key: "customerSetupInvite", group: "customer" },

  // Staff-facing.
  { key: "ticketCreatedStaff", group: "staff" },
  { key: "ticketClosedStaff", group: "staff" },
  { key: "newAssignment", group: "staff" },
  { key: "escalationAlert", group: "staff" },
  { key: "ticketReassigned", group: "staff" },
  { key: "csatUnsatisfiedStaff", group: "staff" },
  { key: "slaBreachedStaff", group: "staff" },
  { key: "ticketUnassignedStaff", group: "staff" },
  { key: "customerRepliedStaff", group: "staff" },
  { key: "accountLockout", group: "staff" },
  { key: "attachmentQuarantined", group: "staff" },
  { key: "staffSetupInvite", group: "staff" },

  // Procurement (goes to whoever raised the request).
  { key: "procurementSubmitted", group: "procurement" },
  { key: "procurementApproved", group: "procurement" },
  { key: "procurementRejected", group: "procurement" },
  { key: "procurementDelivered", group: "procurement" },

  // Accountant billing pipeline.
  { key: "accountantNegativeBalance", group: "accountant" },
  { key: "accountantTicketBilling", group: "accountant" },
];

export const EMAIL_TEMPLATE_KEYS: string[] = EMAIL_TEMPLATE_CATALOG.map(
  (e) => e.key,
);

export function isEmailTemplateKey(value: string): boolean {
  return EMAIL_TEMPLATE_KEYS.includes(value);
}

// Message keys rendered as RICH text (t.rich) rather than plain strings —
// their value embeds markup tags bound to React elements at the call site, so
// a free-text override could silently break the email's links. Excluded from
// the editor entirely rather than validated.
const NON_EDITABLE_FIELDS: Record<string, string[]> = {
  ticketResolved: ["viewLine"],
};

export function isEditableField(templateKey: string, fieldKey: string): boolean {
  return !(NON_EDITABLE_FIELDS[templateKey] ?? []).includes(fieldKey);
}

/**
 * "ticketCreatedStaff" → "Ticket created staff". Derived rather than a
 * hand-written label per template, so a template added later shows up in the
 * editor with a sensible name and no second list to keep in sync.
 */
export function humanizeTemplateKey(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
