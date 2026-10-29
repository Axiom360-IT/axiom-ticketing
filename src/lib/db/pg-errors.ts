// Postgres error codes, read the way this driver actually reports them.
//
// neon-http raises an error carrying `code`; drizzle wraps it, leaving the
// original on `.cause`. Checking only the outer object silently misses the
// wrapped case, which is the one that happens in practice.
//
// By CODE, never by message text: wording changes with locale and driver
// version, SQLSTATE does not.

function codeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const inner = (cause as { code?: unknown }).code;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

/** 42P01 — the table does not exist (a migration has not run). */
export function isUndefinedTable(err: unknown): boolean {
  return codeOf(err) === "42P01";
}

/** 42703 — the column does not exist (a migration has not run). */
export function isUndefinedColumn(err: unknown): boolean {
  return codeOf(err) === "42703";
}
