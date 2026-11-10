import type { Jsonify } from "inngest/types";

// A drop-in stand-in for Inngest's `step` that runs steps inline, in-process.
//
// WHY THIS EXISTS. Inbound email used to be webhook -> Inngest event ->
// `process-inbound-email`. Inngest is a metered third party (Hobby: 50k
// executions/month); when the allowance ran out on 2026-11-08 it kept
// ACCEPTING events but stopped running functions, so every inbound email
// silently failed to become a ticket. The webhook now runs the same processing
// itself (see app/api/email/inbound/route.ts) and keeps Inngest only as a
// fallback, so a metered/unavailable queue can no longer block ticket creation.
//
// The processing code is written against `step.run(id, fn)`, so rather than
// fork it, the same function runs against this shim. It reproduces the two
// behaviours of Inngest's `step.run` that the code relies on:
//
//   1. RETRY. A failing step is retried on its own (Inngest's function had
//      `retries: 2`, i.e. three attempts) without re-running the steps that
//      already succeeded. Here each step gets `attempts` tries with backoff.
//   2. JSON ROUND-TRIP. Inngest persists step results as JSON, so a `Date`
//      comes back as a string. The code is typed for that (`Jsonify<T>`);
//      round-tripping here keeps the direct path byte-for-byte equivalent
//      instead of quietly handing it richer values than it will ever see
//      under Inngest.
//
// What it deliberately does NOT do: memoise across process restarts. If the
// serverless instance dies mid-way, nothing resumes. That is the trade for not
// depending on a queue, and it is why the caller falls back to Inngest when it
// is safe to (see `isSafeToReenqueue`).

export type InboundStep = {
  run: <T>(id: string, fn: () => Promise<T> | T) => Promise<Jsonify<T>>;
};

/**
 * Steps that only READ. If processing fails after nothing but these have run,
 * nothing has been written, so handing the whole email to Inngest to start over
 * cannot create a duplicate. Any step not listed here is treated as a writer.
 *
 * Keep this in step with the step ids in process-inbound-email.ts. An id that
 * is missing is merely treated as a writer (safe: no automatic re-enqueue), so
 * the failure mode of forgetting to update this list is "less automatic
 * recovery", never "duplicate tickets".
 */
export const READ_ONLY_STEPS: ReadonlySet<string> = new Set([
  "fetch-email-content",
  "resolve-by-message-refs",
  "resolve-by-subject-sender",
  "load-ticket",
  "classify-sender",
  "moderation-enabled",
  "count-recent-from-sender",
]);

export type DirectStepTrace = {
  /** Step ids that finished successfully, in order. */
  completed: string[];
  /** The step that exhausted its attempts, if processing failed. */
  failedStep: string | null;
};

export type DirectStepOptions = {
  /** Tries per step (first attempt + retries). Matches Inngest's 1 + 2. */
  attempts?: number;
  /** Delay before retry n (0-based). Overridable so tests don't sleep. */
  backoffMs?: (retryIndex: number) => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultBackoff = (i: number) => [500, 1500][i] ?? 1500;

export function createDirectStep(
  options: DirectStepOptions = {},
): { step: InboundStep; trace: DirectStepTrace } {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoff = options.backoffMs ?? defaultBackoff;
  const sleep = options.sleep ?? defaultSleep;
  const trace: DirectStepTrace = { completed: [], failedStep: null };

  const step: InboundStep = {
    run: async <T>(id: string, fn: () => Promise<T> | T) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const value = await fn();
          trace.completed.push(id);
          // JSON round-trip, as Inngest does. `undefined` stays `undefined`
          // (JSON.stringify(undefined) is not valid input to JSON.parse).
          const out =
            value === undefined ? value : JSON.parse(JSON.stringify(value));
          return out as Jsonify<T>;
        } catch (err) {
          lastError = err;
          if (attempt < attempts - 1) await sleep(backoff(attempt));
        }
      }
      trace.failedStep = id;
      throw lastError;
    },
  };

  return { step, trace };
}

/**
 * True when a failed direct run provably wrote nothing, so replaying the whole
 * email through Inngest cannot duplicate a ticket or message.
 *
 * The step that failed counts too: a writer that failed part-way may have
 * written something, so only a failure inside a read-only step qualifies.
 */
export function isSafeToReenqueue(trace: DirectStepTrace): boolean {
  if (trace.failedStep !== null && !READ_ONLY_STEPS.has(trace.failedStep)) {
    return false;
  }
  return trace.completed.every((id) => READ_ONLY_STEPS.has(id));
}
