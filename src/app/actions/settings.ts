"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { holidays } from "@/lib/db/schema/holidays";
import { settings as settingsTable } from "@/lib/db/schema/settings";
import { invalidateSetting } from "@/lib/settings";
import {
  isValidSettingKey,
  READ_ONLY_AFTER_FIRST_SET,
  SETTING_KEYS,
  SETTING_SCHEMAS,
  type SettingKey,
} from "@/lib/settings-registry";
import { inngest } from "@/inngest/client";

class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export type UpdateSettingResult =
  | { ok: true }
  | { ok: false; error: string };

// ── updateSetting ─────────────────────────────────────────────────

export async function updateSetting(
  key: string,
  rawValue: unknown,
): Promise<UpdateSettingResult> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  if (!isValidSettingKey(key)) {
    return { ok: false, error: `Unknown setting key: ${key}` };
  }
  const schema = SETTING_SCHEMAS[key as SettingKey];
  const parsed = schema.safeParse(rawValue);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid value",
    };
  }

  // For read-only-after-first-set keys, refuse if a non-empty value already exists.
  if (READ_ONLY_AFTER_FIRST_SET.has(key as SettingKey)) {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, key))
      .limit(1);
    const existing = row?.value as unknown;
    const hasExisting =
      existing !== undefined &&
      existing !== null &&
      !(typeof existing === "string" && existing.length === 0);
    if (hasExisting) {
      return {
        ok: false,
        error: "This setting can't be changed after it's been set.",
      };
    }
  }

  const [before] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);

  // Upsert pattern: insert or update by key.
  await db
    .insert(settingsTable)
    .values({
      key,
      value: parsed.data as object,
      updatedById: caller.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: {
        value: parsed.data as object,
        updatedById: caller.id,
        updatedAt: new Date(),
      },
    });

  // Invalidate this instance's cache immediately, AND emit the event so
  // other instances pick up the change. Local-first matters because the
  // current request might re-read the setting before Inngest delivers.
  invalidateSetting(key);
  try {
    await inngest.send({ name: "setting/updated", data: { key } });
  } catch (err) {
    console.error("[updateSetting] inngest emit failed:", err);
  }

  await audit({
    actorId: caller.id,
    action: "setting.update",
    targetType: "setting",
    targetId: key,
    before: { value: before?.value ?? null },
    after: { value: parsed.data },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

// ── Holidays ──────────────────────────────────────────────────────

const holidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  label: z.string().trim().min(1).max(120),
});

export type AddHolidayResult = { ok: true } | { ok: false; error: string };

export async function addHoliday(
  date: string,
  label: string,
): Promise<AddHolidayResult> {
  const parsed = holidaySchema.safeParse({ date, label });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  await db
    .insert(holidays)
    .values({
      date: parsed.data.date,
      label: parsed.data.label,
      createdById: caller.id,
    })
    .onConflictDoUpdate({
      target: holidays.date,
      set: {
        label: parsed.data.label,
        createdById: caller.id,
      },
    });

  await audit({
    actorId: caller.id,
    action: "holiday.upsert",
    targetType: "holiday",
    targetId: parsed.data.date,
    after: { label: parsed.data.label },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function removeHoliday(
  date: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(date);
  if (!parsed.success) {
    return { ok: false, error: "Invalid date" };
  }
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  await db.delete(holidays).where(eq(holidays.date, parsed.data));
  await audit({
    actorId: caller.id,
    action: "holiday.remove",
    targetType: "holiday",
    targetId: parsed.data,
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

// ── Read helper for the panel ─────────────────────────────────────

export type SettingsSnapshot = Partial<Record<SettingKey, unknown>>;

export async function loadSettingsSnapshot(): Promise<{
  values: SettingsSnapshot;
  holidays: { date: string; label: string }[];
}> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable);
  const values: SettingsSnapshot = {};
  for (const r of rows) {
    if (isValidSettingKey(r.key)) {
      values[r.key] = r.value;
    }
  }
  // Make sure every known key shows up — UI binds against them.
  for (const k of SETTING_KEYS) {
    if (!(k in values)) values[k] = undefined;
  }
  const holidayRows = await db
    .select({ date: holidays.date, label: holidays.label })
    .from(holidays)
    .orderBy(asc(holidays.date));
  return { values, holidays: holidayRows };
}
