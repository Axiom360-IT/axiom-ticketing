// Curated icon vocabulary for ticket_types.icon (§5.1). Kept separate from
// the lucide-react component map (type-icons.tsx) so schema/action/MCP code
// that only needs to validate or default a key doesn't pull in an icon
// library. Add a key here AND to TICKET_TYPE_ICON_COMPONENTS to introduce a
// new icon — the two lists must stay in sync (typecheck catches a mismatch).

export const TICKET_TYPE_ICON_KEYS = [
  "tag",
  "headset",
  "wrench",
  "bug",
  "rocket",
  "bell",
  "alert-triangle",
  "refresh-cw",
  "package",
  "shield-alert",
  "clipboard",
  "zap",
  "settings",
  "users",
  "mail",
  "file-text",
  "building",
  "credit-card",
  "truck",
  "server",
  "lock",
  "wifi",
  "phone",
  "boxes",
  "flag",
  "sparkles",
  "puzzle",
  "shapes",
  "bookmark",
  "circle-dot",
] as const;

export type TicketTypeIconKey = (typeof TICKET_TYPE_ICON_KEYS)[number];

export const DEFAULT_TICKET_TYPE_ICON: TicketTypeIconKey = "tag";

export function isTicketTypeIconKey(value: string): value is TicketTypeIconKey {
  return (TICKET_TYPE_ICON_KEYS as readonly string[]).includes(value);
}

// Best-effort label → icon suggestion, used only to pre-fill the picker when
// an admin creates a new type — never applied silently; the admin can always
// override before saving, and it never re-fires on an existing type's
// already-chosen icon. First matching rule wins, so put more specific
// patterns first within a category if you add more.
const SUGGESTION_RULES: readonly [RegExp, TicketTypeIconKey][] = [
  [/incident/i, "alert-triangle"],
  [/change/i, "refresh-cw"],
  [/project/i, "rocket"],
  [/alert/i, "bell"],
  [/service.?request|support/i, "headset"],
  [/bug|defect/i, "bug"],
  [/hardware|equipment|device/i, "wrench"],
  [/shipping|delivery|order/i, "truck"],
  [/security|breach/i, "shield-alert"],
  [/network|wifi|connectivity/i, "wifi"],
  [/server|infrastructure/i, "server"],
  [/access|login|password/i, "lock"],
  [/billing|invoice|payment/i, "credit-card"],
  [/email|mail/i, "mail"],
  [/onboarding|account/i, "users"],
  [/maintenance|upgrade|config/i, "settings"],
  [/urgent|escalation|critical/i, "zap"],
  [/call|phone/i, "phone"],
  [/document|report/i, "file-text"],
  [/facility|building|office/i, "building"],
];

export function suggestTicketTypeIcon(label: string): TicketTypeIconKey {
  for (const [pattern, icon] of SUGGESTION_RULES) {
    if (pattern.test(label)) return icon;
  }
  return DEFAULT_TICKET_TYPE_ICON;
}
