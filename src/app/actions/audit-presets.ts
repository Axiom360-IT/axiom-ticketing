"use server";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditFilterPresets } from "@/lib/db/schema/audit-filter-presets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

// Team-shared audit-log filter bookmarks. Low-stakes by design: a preset is
// just a stored query string — applying one re-runs the SAME can()/strict-
// technician scoping the audit page already enforces on every read, so a
// preset can't leak anything its viewer couldn't already see directly.
// Gated on audit.view alone (not a dedicated permission) for that reason.

async function requireAuditView() {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return caller;
}

export type AuditFilterPreset = {
  id: string;
  name: string;
  queryString: string;
  createdAt: Date;
};

export async function listAuditFilterPresets(): Promise<AuditFilterPreset[]> {
  await requireAuditView();
  return db
    .select({
      id: auditFilterPresets.id,
      name: auditFilterPresets.name,
      queryString: auditFilterPresets.queryString,
      createdAt: auditFilterPresets.createdAt,
    })
    .from(auditFilterPresets)
    .orderBy(desc(auditFilterPresets.createdAt))
    .limit(100);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Whatever's after the "?" in the current URL — deliberately unstructured,
  // see the schema module's doc comment for why.
  queryString: z.string().trim().max(2000),
});

export type CreatePresetResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createAuditFilterPreset(
  input: z.infer<typeof createSchema>,
): Promise<CreatePresetResult> {
  const caller = await requireAuditView();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const id = randomUUID();
  try {
    await db.insert(auditFilterPresets).values({
      id,
      name: parsed.data.name,
      queryString: parsed.data.queryString,
      createdById: caller.id,
    });
  } catch (err) {
    // Unique index on name — surface a friendly message instead of a raw
    // constraint-violation error.
    const message = err instanceof Error ? err.message : "";
    if (message.includes("audit_filter_presets_name_key")) {
      return { ok: false, error: "A preset with that name already exists." };
    }
    return { ok: false, error: "Could not save preset." };
  }

  revalidatePath("/admin/audit");
  return { ok: true, id };
}

export async function deleteAuditFilterPreset(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuditView();
  const [existing] = await db
    .select({ id: auditFilterPresets.id })
    .from(auditFilterPresets)
    .where(eq(auditFilterPresets.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError();

  await db.delete(auditFilterPresets).where(eq(auditFilterPresets.id, id));
  revalidatePath("/admin/audit");
  return { ok: true };
}
