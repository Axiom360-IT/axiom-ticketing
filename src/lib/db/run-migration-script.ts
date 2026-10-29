import { spawnSync } from "node:child_process";

// Run one migration script in its own process and report how it went.
//
// A child process rather than an import, because the existing scripts are
// written as standalone programs: each calls `main().then(process.exit)` at the
// top level, so importing one would run it and kill the runner on the spot.
// Rewriting 30 scripts to export a function would be a far bigger change than
// this one, to touch code that has already run in production.

export type ScriptResult =
  | { ok: true }
  | { ok: false; reason: string };

export const DEFAULT_SCRIPT_TIMEOUT_MS = 180_000;

export function runMigrationScript(
  file: string,
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): ScriptResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", file], {
    // Stream the script's own output into the build log.
    stdio: "inherit",
    env: opts.env ?? process.env,
    // A hung migration must fail the build, not hang it for the platform's
    // whole build limit.
    timeout: opts.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
  });

  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return {
      ok: false,
      reason: timedOut
        ? `timed out after ${(opts.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS) / 1000}s`
        : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `exited with code ${result.status ?? `signal ${result.signal}`}`,
    };
  }
  return { ok: true };
}
