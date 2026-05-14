import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { settings } from "./db/schema/settings";

export async function getSetting<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (row.length === 0) return undefined;
  return row[0].value as T;
}

export async function getSettings<T extends Record<string, unknown>>(
  keys: readonly string[],
): Promise<T> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys as string[]));

  const result = {} as Record<string, unknown>;
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result as T;
}
