import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { settings } from "./db/schema/settings";

// In-memory cache. Per-process (no cross-instance sync yet — that's M8 with
// the settings/updated Inngest event). Acceptable for dev and single-instance
// deployments. Production multi-instance should add cache invalidation.
const cache = new Map<string, unknown>();

export async function getSetting<T = unknown>(
  key: string,
): Promise<T | undefined> {
  if (cache.has(key)) return cache.get(key) as T;

  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (row.length === 0) return undefined;
  const value = row[0].value as T;
  cache.set(key, value);
  return value;
}

export async function getSettings<T extends Record<string, unknown>>(
  keys: readonly string[],
): Promise<T> {
  const result = {} as Record<string, unknown>;
  const missing: string[] = [];

  for (const key of keys) {
    if (cache.has(key)) {
      result[key] = cache.get(key);
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, missing));

    for (const r of rows) {
      result[r.key] = r.value;
      cache.set(r.key, r.value);
    }
  }

  return result as T;
}

/** Clears the cache for a key. Call after writes. */
export function invalidateSetting(key: string): void {
  cache.delete(key);
}

/** Clears the entire cache. Call when many settings change at once. */
export function invalidateAllSettings(): void {
  cache.clear();
}
