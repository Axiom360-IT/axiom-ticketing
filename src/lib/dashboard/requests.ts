/**
 * Run a dashboard server action from the browser.
 *
 * A request that never completes (offline, dropped connection, server
 * restarting) REJECTS instead of returning a result. Left uncaught, that replaces
 * the whole dashboard with the error screen, or leaves a widget loading forever.
 * Here it becomes an ordinary failed result the grid can show a message for.
 */
export async function reachServer<T>(
  call: () => Promise<T>,
): Promise<T | { ok: false; reason: "offline" }> {
  try {
    return await call();
  } catch (err) {
    console.error("[dashboard] request failed", err);
    return { ok: false, reason: "offline" };
  }
}
