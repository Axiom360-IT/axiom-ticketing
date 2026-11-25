"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/auth/session";
import type { WidgetData } from "@/lib/dashboard/chart-spec";
import { sanitizeLayout } from "@/lib/dashboard/layout";
import { saveDashboardLayoutRow, viewerOf } from "@/lib/dashboard/store";
import { loadWidgetData } from "@/lib/dashboard/widget-data";

// A person's own dashboard arrangement. Personal preference, so there is no
// permission to check beyond being signed in — what matters is that a layout can
// never name a widget the person is not allowed to have, which is enforced by
// `sanitizeLayout` against THEIR current permissions, not whatever the browser
// claims. Failures return a reason code, not text; the screen translates it.

export type DashboardActionResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unavailable" };

export async function saveDashboardLayout(
  input: unknown,
): Promise<DashboardActionResult> {
  const user = await requireSessionUser();

  const layout = sanitizeLayout(input, viewerOf(user));
  if (!layout) return { ok: false, reason: "invalid" };

  try {
    await saveDashboardLayoutRow(user.id, layout);
  } catch (err) {
    // Most likely the table doesn't exist yet (see add-dashboard-layouts).
    console.error("[dashboard] save failed", err);
    return { ok: false, reason: "unavailable" };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export type WidgetDataResult =
  | ({ ok: true } & WidgetData)
  | { ok: false; reason: "forbidden" | "unavailable" };

/**
 * The data for one on-demand widget, fetched when a person adds it while
 * customizing (widgets they have not placed are not loaded with the page).
 * `loadWidgetData` re-checks the widget against the caller's current
 * permissions, so asking for one by id cannot return data they may not see.
 */
export async function loadDashboardWidget(id: string): Promise<WidgetDataResult> {
  const user = await requireSessionUser();
  try {
    const data = await loadWidgetData(id, user);
    return data ? { ok: true, ...data } : { ok: false, reason: "forbidden" };
  } catch (err) {
    console.error("[dashboard] widget data failed", id, err);
    return { ok: false, reason: "unavailable" };
  }
}
