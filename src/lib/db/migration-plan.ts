// ── The decisions the migration runner makes, with no I/O ─────────────
//
// Split from deploy-migrations.ts so the part that can do damage — deciding
// WHETHER to touch a database, and WHICH migrations — is unit-tested, while the
// part that does the touching stays thin.

import type { DeployMigration } from "./migration-manifest";

export type RunEnv = {
  /** Vercel sets this to production | preview | development. Absent locally and
   *  in GitHub CI, which is exactly what keeps those from migrating anything. */
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
  /** Explicit escape hatch for a deploy that must go out without migrating. */
  SKIP_DEPLOY_MIGRATIONS?: string;
};

export type RunDecision =
  | { action: "run" }
  | { action: "skip"; reason: string }
  | { action: "fail"; reason: string };

/**
 * Should this invocation migrate?
 *
 * The default is NO. Migrating is opt-in by being a production Vercel build, or
 * by passing --force by hand. A preview build, a CI build and a developer's
 * laptop all fall through to "skip", because the variable that would let them
 * reach the production database is the same one a preview deployment might
 * share, and a preview of an unmerged branch must never alter production's
 * schema.
 */
export function decideRun(env: RunEnv, opts: { force: boolean }): RunDecision {
  if (env.SKIP_DEPLOY_MIGRATIONS === "1") {
    return {
      action: "skip",
      reason: "SKIP_DEPLOY_MIGRATIONS=1 — migrations deliberately skipped for this deploy",
    };
  }
  if (!opts.force && env.VERCEL_ENV !== "production") {
    return {
      action: "skip",
      reason: `not a production deploy (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})`,
    };
  }
  if (!env.DATABASE_URL) {
    // The one case that must NOT skip quietly. Skipping would let the new code
    // ship against a schema that has not been migrated — the exact failure this
    // runner exists to prevent — so fail the build and leave the old version
    // serving. The message says how to get unstuck.
    return {
      action: "fail",
      reason:
        "DATABASE_URL is not available to this build, so migrations cannot run. " +
        "In Vercel → Settings → Environment Variables, make sure DATABASE_URL is " +
        "enabled for the Production environment's BUILD (not only runtime). " +
        "To deploy anyway without migrating, set SKIP_DEPLOY_MIGRATIONS=1.",
    };
  }
  return { action: "run" };
}

/** What still has to run, in manifest order. */
export function pendingMigrations(
  manifest: readonly DeployMigration[],
  applied: ReadonlySet<string>,
): DeployMigration[] {
  return manifest.filter((m) => !applied.has(m.id));
}

/** Postgres reports a probe that references a missing column/table as an error
 *  rather than as "no rows". Both mean the same thing here: not in place. */
export function probeErrorMeansNotApplied(code: string | undefined): boolean {
  return code === "42703" || code === "42P01";
}
