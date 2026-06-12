/**
 * Humanize a raw permission string for display when no i18n label exists —
 * e.g. a stale permission that was removed from the system but is still stored
 * on a role. "procurement.mark_purchased" -> "Procurement: mark purchased".
 */
export function humanizePermission(perm: string): string {
  const [group, ...rest] = perm.split(".");
  const action = rest.join(" ").replace(/_/g, " ").trim();
  const g = group ? group.charAt(0).toUpperCase() + group.slice(1) : perm;
  return action ? `${g}: ${action}` : g;
}

/**
 * Resolve a permission's display label: the i18n label if present, otherwise a
 * humanized fallback. next-intl returns the namespaced key path for a missing
 * message, so a result that still contains the namespace means "missing" — we
 * fall back rather than show the raw `roles.matrix.label.<key>` string.
 */
export function permissionLabel(
  perm: string,
  t: (key: string) => string,
): string {
  const label = t(perm.replace(/\./g, "__"));
  return label.includes("roles.matrix.label")
    ? humanizePermission(perm)
    : label;
}
