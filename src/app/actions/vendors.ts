"use server";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { vendors } from "@/lib/db/schema/vendors";
import { ForbiddenError } from "@/lib/errors";

// Vendor list management is admin configuration — gated on `settings.update`,
// same as ticket categories/types.
async function requireVendorManager(): Promise<{ id: string }> {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return user;
}

type Result = { ok: true } | { ok: false; error: string };

const nameSchema = z.string().trim().min(1).max(200);

export type AdminVendor = {
  id: string;
  name: string;
  isActive: boolean;
  /** How many procurement requests currently reference this vendor's name
   *  (drives the delete guard). Matched case-insensitively since the request
   *  field is free text, not a reference to this row. */
  inUse: number;
};

export async function listVendorsForAdmin(): Promise<AdminVendor[]> {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const [rows, usage] = await Promise.all([
    db.select().from(vendors).orderBy(asc(vendors.name)),
    db
      .select({
        name: sql<string>`lower(${procurementRequests.vendor})`,
        n: count(),
      })
      .from(procurementRequests)
      .where(sql`${procurementRequests.vendor} IS NOT NULL`)
      .groupBy(sql`lower(${procurementRequests.vendor})`),
  ]);
  const useMap = new Map(usage.map((u) => [u.name, Number(u.n)]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    inUse: useMap.get(r.name.toLowerCase()) ?? 0,
  }));
}

/** Active vendors for the procurement-form picker. Any signed-in staff can
 *  read this — it's just names, and `procurement.create` already gates who
 *  can actually submit a request. */
export async function listActiveVendors(): Promise<
  { id: string; name: string }[]
> {
  await requireSessionUser();
  return db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(eq(vendors.isActive, true))
    .orderBy(asc(vendors.name));
}

export async function createVendor(name: string): Promise<Result> {
  const user = await requireVendorManager();
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: "Enter a vendor name (1–200 characters)." };
  }
  const clean = parsed.data;

  const dup = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(sql`lower(${vendors.name}) = ${clean.toLowerCase()}`)
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, error: "A vendor with that name already exists." };
  }

  const [row] = await db
    .insert(vendors)
    .values({ name: clean, createdById: user.id })
    .returning({ id: vendors.id });

  await audit({
    actorId: user.id,
    action: "vendor.create",
    targetType: "vendor",
    targetId: row.id,
    after: { name: clean },
  });

  revalidatePath("/admin/vendors");
  return { ok: true };
}

export async function renameVendor(id: string, name: string): Promise<Result> {
  const user = await requireVendorManager();
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: "Enter a vendor name (1–200 characters)." };
  }
  const clean = parsed.data;

  const [current] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Vendor not found." };

  const dup = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(ne(vendors.id, id), sql`lower(${vendors.name}) = ${clean.toLowerCase()}`),
    )
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, error: "A vendor with that name already exists." };
  }

  await db
    .update(vendors)
    .set({ name: clean, updatedAt: new Date() })
    .where(eq(vendors.id, id));

  await audit({
    actorId: user.id,
    action: "vendor.update",
    targetType: "vendor",
    targetId: id,
    before: { name: current.name },
    after: { name: clean },
  });

  revalidatePath("/admin/vendors");
  return { ok: true };
}

export async function setVendorActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const user = await requireVendorManager();
  const [current] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Vendor not found." };

  await db
    .update(vendors)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(vendors.id, id));

  await audit({
    actorId: user.id,
    action: "vendor.update",
    targetType: "vendor",
    targetId: id,
    before: { isActive: current.isActive },
    after: { isActive },
  });

  revalidatePath("/admin/vendors");
  return { ok: true };
}

export async function deleteVendor(id: string): Promise<Result> {
  const user = await requireVendorManager();
  const [current] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Vendor not found." };

  const [used] = await db
    .select({ n: count() })
    .from(procurementRequests)
    .where(sql`lower(${procurementRequests.vendor}) = ${current.name.toLowerCase()}`);
  if (Number(used?.n ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This vendor is referenced by existing procurement requests — deactivate it instead so those requests keep their label.",
    };
  }

  await db.delete(vendors).where(eq(vendors.id, id));

  await audit({
    actorId: user.id,
    action: "vendor.delete",
    targetType: "vendor",
    targetId: id,
    before: { name: current.name },
  });

  revalidatePath("/admin/vendors");
  return { ok: true };
}
