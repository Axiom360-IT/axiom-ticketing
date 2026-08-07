import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db } from "@/lib/db/client";
import { holidays } from "@/lib/db/schema/holidays";
import { notificationPreferences } from "@/lib/db/schema/notifications";
import { isValidSettingKey, SETTING_KEYS } from "@/lib/settings-registry";
import { staffEventsForRoles, TOGGLEABLE_EVENT_TYPES } from "@/lib/notifications/audience";
import type { NotificationEventType } from "@/inngest/client";

// Mirrors app/actions/settings.ts's holiday actions and app/actions/
// profile.ts's notification-preference action, adapted to take an explicit
// SessionUser.
//
// `updateSetting` is DELIBERATELY NOT fully wired here: the real action
// (app/actions/settings.ts updateSetting) requires a fresh interactive
// password re-confirmation (M17 — "settings changes affect everyone").
// There's no equivalent step over an MCP bearer-token connection, so rather
// than skip that control, this tool just tells the caller it can't be done
// here and to use the admin panel. Same principle as Super-Admin grants in
// users-write.ts: MCP can do LESS than the UI, never bypass a confirmation
// step the UI requires.

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

// ── add_holiday / remove_holiday ─────────────────────────────────────────
// Mirrors addHoliday/removeHoliday (app/actions/settings.ts ~128-198). No
// reauth requirement on these — fully usable via MCP.
export async function addHolidayViaMcp(user: SessionUser, date: string, label: string): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD." };
  if (!(await can(user, "settings.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to update settings." };
  }

  await db
    .insert(holidays)
    .values({ date, label: label.trim(), createdById: user.id })
    .onConflictDoUpdate({ target: holidays.date, set: { label: label.trim(), createdById: user.id } });

  await audit({ actorId: user.id, action: "holiday.upsert", targetType: "holiday", targetId: date, after: { label, via: "mcp" } });
  return { ok: true };
}

export async function removeHolidayViaMcp(user: SessionUser, date: string): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD." };
  if (!(await can(user, "settings.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to update settings." };
  }
  await db.delete(holidays).where(eq(holidays.date, date));
  await audit({ actorId: user.id, action: "holiday.remove", targetType: "holiday", targetId: date, after: { via: "mcp" } });
  return { ok: true };
}

// ── update_setting (informational refusal) ──────────────────────────────
export async function updateSettingViaMcp(key: string): Promise<Result> {
  if (!isValidSettingKey(key)) {
    return { ok: false, error: `Unknown setting key: ${key}. Valid keys include: ${SETTING_KEYS.slice(0, 10).join(", ")}, …` };
  }
  return {
    ok: false,
    error: `Settings changes require a fresh password confirmation, which isn't possible through this connector. Go to Admin → Settings to change "${key}" directly.`,
  };
}

// ── update_my_notification_preference ────────────────────────────────────
// Mirrors updateNotificationPreference (app/actions/profile.ts ~369+). Self-
// scoped — no target-user lookup, always operates on the caller.
export async function updateMyNotificationPreferenceViaMcp(
  user: SessionUser,
  eventType: string,
  channel: "email" | "sms",
  enabled: boolean,
): Promise<Result> {
  if (!TOGGLEABLE_EVENT_TYPES.has(eventType as NotificationEventType)) {
    return { ok: false, error: `Unknown event type: ${eventType}` };
  }
  const setValues = channel === "email" ? { emailEnabled: enabled } : { smsEnabled: enabled };
  await db
    .insert(notificationPreferences)
    .values({
      userId: user.id,
      eventType,
      emailEnabled: channel === "email" ? enabled : true,
      smsEnabled: channel === "sms" ? enabled : true,
    })
    .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.eventType], set: setValues });

  await audit({
    actorId: user.id,
    action: "user.update_notification_preference",
    targetType: "notification_preference",
    targetId: `${user.id}:${eventType}`,
    after: { channel, enabled, via: "mcp" },
  });
  return { ok: true };
}

// ── enable_all_my_notifications ───────────────────────────────────────────
// New convenience tool, not a 1:1 port — loops updateMyNotificationPreference
// over every event this user's role(s) can tune (staffEventsForRoles), both
// channels, satisfying "turn all my notifications on/off" as one command.
export async function setAllMyNotificationPreferencesViaMcp(user: SessionUser, enabled: boolean): Promise<Result> {
  const events = staffEventsForRoles(user.roleNames);
  for (const eventType of events) {
    await db
      .insert(notificationPreferences)
      .values({ userId: user.id, eventType, emailEnabled: enabled, smsEnabled: enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.eventType],
        set: { emailEnabled: enabled, smsEnabled: enabled },
      });
  }
  await audit({
    actorId: user.id,
    action: "user.update_notification_preference",
    targetType: "notification_preference",
    targetId: user.id,
    after: { bulk: true, enabled, eventCount: events.length, via: "mcp" },
  });
  return { ok: true, eventCount: events.length };
}

// ── MCP tool registration ────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
const CONFIRM_NOTE =
  " Before calling this, always show the user exactly what will change and get their explicit go-ahead in the chat first — never call this on the first ask.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSettingsWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "add_holiday",
    {
      title: "Add a business-hours holiday",
      description: "Adds (or updates) a holiday date, which SLA calculations skip." + CONFIRM_NOTE,
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1) },
    },
    async ({ date, label }: { date: string; label: string }) => {
      const r = await addHolidayViaMcp(user, date, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "remove_holiday",
    {
      title: "Remove a business-hours holiday",
      description: "Removes a holiday date." + CONFIRM_NOTE,
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    },
    async ({ date }: { date: string }) => {
      const r = await removeHolidayViaMcp(user, date);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "update_setting",
    {
      title: "Update a system setting",
      description:
        "Settings changes require an interactive password confirmation that isn't possible through this connector — calling this will tell the user which admin-panel page to use instead of applying anything.",
      inputSchema: { key: z.string().min(1) },
    },
    async ({ key }: { key: string }) => {
      const r = await updateSettingViaMcp(key);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "update_my_notification_preference",
    {
      title: "Update one of my notification preferences",
      description: "Turns email or SMS on/off for one event type, for the connected user's own account." + CONFIRM_NOTE,
      inputSchema: { eventType: z.string().min(1), channel: z.enum(["email", "sms"]), enabled: z.boolean() },
    },
    async ({ eventType, channel, enabled }: { eventType: string; channel: "email" | "sms"; enabled: boolean }) => {
      const r = await updateMyNotificationPreferenceViaMcp(user, eventType, channel, enabled);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "enable_all_my_notifications",
    {
      title: "Turn all my notifications on or off",
      description: "Sets every notification event (email + SMS) the connected user's role can receive to on or off in one go." + CONFIRM_NOTE,
      inputSchema: { enabled: z.boolean().default(true) },
    },
    async ({ enabled }: { enabled: boolean }) => {
      const r = await setAllMyNotificationPreferencesViaMcp(user, enabled);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
