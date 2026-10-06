import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { automationRuns } from "@/lib/db/schema/automations";

// ── Run history ───────────────────────────────────────────────────────
//
// Everything here is BEST-EFFORT. A job must never fail because its own
// bookkeeping failed — an unwritable history row is an inconvenience, a
// customer who never got their SLA alert is not. Every write is wrapped, and
// a failure is logged and swallowed.

export type RunStatus = "running" | "ok" | "skipped" | "error";

export type AutomationRunRow = {
  id: string;
  automationId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  summary: unknown;
  error: string | null;
};

/**
 * Wrap an automation body so its outcome lands in `automation_runs`.
 *
 * A job that returns `{ skipped: ... }` is recorded as `skipped` rather than
 * `ok` — the distinction is the whole point of the panel. "Ran, did nothing,
 * because it is switched off" and "ran, did nothing, because there was
 * nothing to do" both beat a green tick that tells you neither.
 *
 * Errors are recorded and then RE-THROWN, so Inngest still sees the failure
 * and retries. Swallowing here would make the panel look healthy while work
 * silently stopped.
 */
export async function withAutomationRun<T>(
  automationId: string,
  body: () => Promise<T>,
): Promise<T> {
  const runId = await startRun(automationId);
  try {
    const result = await body();
    const skipped =
      result !== null &&
      typeof result === "object" &&
      "skipped" in (result as Record<string, unknown>);
    await finishRun(runId, skipped ? "skipped" : "ok", result, null);
    return result;
  } catch (err) {
    await finishRun(
      runId,
      "error",
      null,
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    throw err;
  }
}

async function startRun(automationId: string): Promise<string | null> {
  try {
    const [row] = await db
      .insert(automationRuns)
      .values({ automationId, status: "running" })
      .returning();
    return row?.id ?? null;
  } catch (err) {
    console.error(`[automations] could not open a run row for ${automationId}:`, err);
    return null;
  }
}

async function finishRun(
  runId: string | null,
  status: RunStatus,
  summary: unknown,
  error: string | null,
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(automationRuns)
      .set({
        status,
        finishedAt: new Date(),
        // Keep the row small and never let a huge payload break the write.
        summary: summary === undefined ? null : (truncate(summary) as never),
        error: error ? error.slice(0, 4000) : null,
      })
      .where(eq(automationRuns.id, runId));
  } catch (err) {
    console.error("[automations] could not close run row:", err);
  }
}

/** Stop a pathological summary (a job that returns 10k ids) filling the table. */
function truncate(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json !== undefined && json.length <= 4000) return value;
  return { truncated: true, bytes: json?.length ?? 0 };
}

/** The most recent run for each of the given automations, in one query. */
export async function latestRunByAutomation(
  automationIds: string[],
): Promise<Map<string, AutomationRunRow>> {
  if (automationIds.length === 0) return new Map();

  // DISTINCT ON is the cheap way to do "latest per group" in Postgres, and it
  // rides the (automation_id, started_at DESC) index directly.
  const rows = await db
    .selectDistinctOn([automationRuns.automationId])
    .from(automationRuns)
    .where(inArray(automationRuns.automationId, automationIds))
    .orderBy(automationRuns.automationId, desc(automationRuns.startedAt));

  return new Map(rows.map((r) => [r.automationId, r as AutomationRunRow]));
}

/** Recent runs across everything, for the activity list. */
export async function listRecentRuns(limit = 50): Promise<AutomationRunRow[]> {
  const rows = await db
    .select()
    .from(automationRuns)
    .orderBy(desc(automationRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows as AutomationRunRow[];
}

/** Failure counts per automation over a trailing window, for the health badge. */
export async function failureCounts(
  automationIds: string[],
  sinceHours = 24,
): Promise<Map<string, number>> {
  if (automationIds.length === 0) return new Map();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      automationId: automationRuns.automationId,
      n: sql<number>`count(*)::int`,
    })
    .from(automationRuns)
    .where(
      and(
        inArray(automationRuns.automationId, automationIds),
        eq(automationRuns.status, "error"),
        sql`${automationRuns.startedAt} >= ${since}`,
      ),
    )
    .groupBy(automationRuns.automationId);
  return new Map(rows.map((r) => [r.automationId, Number(r.n)]));
}

/** Retention. Called from the nightly housekeeping job. */
export async function pruneRunHistory(olderThanDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(automationRuns)
    .where(lt(automationRuns.startedAt, cutoff))
    .returning();
  return deleted.length;
}
