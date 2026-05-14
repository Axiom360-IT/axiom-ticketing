/**
 * Format a byte count as a short human-readable string.
 * Uses 1024 (binary) units; resolution caps at MB to keep avatars/bullets terse.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Two-letter initials for avatars. Single-word names fall back to the first
 * two letters of the word; otherwise it's first-of-first + first-of-last.
 * Always returns at least one character.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase() || "?";
  }
  const first = parts[0]![0] ?? "";
  const last = parts[parts.length - 1]![0] ?? "";
  return (first + last).toUpperCase() || "?";
}
