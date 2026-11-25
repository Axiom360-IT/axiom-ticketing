import "server-only";
import { eq } from "drizzle-orm";
import { isStrictTechnician, type SessionUser } from "@/lib/auth/can";
import { db } from "@/lib/db/client";
import { dashboardLayouts } from "@/lib/db/schema/dashboard-layouts";
import { defaultLayout, sanitizeLayout, type DashboardLayout } from "./layout";
import type { Viewer } from "./widgets";

/** What the widget rules need to know about a signed-in user. */
export function viewerOf(user: SessionUser): Viewer {
  return { strictTech: isStrictTechnician(user), permissions: user.permissions };
}

/**
 * The layout to draw for this person: their saved one if it is still valid,
 * otherwise the default.
 *
 * It must never throw. The dashboard is the landing page, and "I couldn't read
 * your arrangement" is no reason to show an error instead of it — so a missing
 * table (code deployed before the migration), a database hiccup, or a saved
 * value that no longer parses all fall back to the default and log why.
 */
export async function loadDashboardLayout(
  user: SessionUser,
): Promise<{ layout: DashboardLayout; saved: boolean }> {
  const viewer = viewerOf(user);
  try {
    const [row] = await db
      .select({ layout: dashboardLayouts.layout })
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.userId, user.id))
      .limit(1);
    if (row) {
      const layout = sanitizeLayout(row.layout, viewer);
      if (layout) return { layout, saved: true };
      console.error("[dashboard] saved layout is not valid; using the default");
    }
  } catch (err) {
    console.error("[dashboard] could not read the saved layout; using the default", err);
  }
  return { layout: defaultLayout(viewer), saved: false };
}

/** Save (insert or replace) a person's layout. The caller has already sanitised it. */
export async function saveDashboardLayoutRow(
  userId: string,
  layout: DashboardLayout,
): Promise<void> {
  await db
    .insert(dashboardLayouts)
    .values({ userId, layout })
    .onConflictDoUpdate({
      target: dashboardLayouts.userId,
      set: { layout, updatedAt: new Date() },
    });
}
