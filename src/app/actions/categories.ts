"use server";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { ticketCategories } from "@/lib/db/schema/ticket-categories";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError } from "@/lib/errors";

// Category management is admin configuration — gated on `settings.update`
// (Super Admin by default; grant it to a role to let them manage categories).
async function requireCategoryManager(): Promise<{ id: string }> {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return user;
}

type Result = { ok: true } | { ok: false; error: string };

const labelSchema = z.string().trim().min(1).max(40);

/** slug from a label: lower snake_case, alphanumerics only. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type AdminTicketCategory = {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  /** How many tickets currently use this category (drives the delete guard). */
  inUse: number;
};

export async function listCategoriesForAdmin(): Promise<AdminTicketCategory[]> {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(ticketCategories)
      .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label)),
    db
      .select({ value: tickets.category, n: count() })
      .from(tickets)
      .groupBy(tickets.category),
  ]);
  const useMap = new Map(usage.map((u) => [u.value, Number(u.n)]));
  return rows.map((r) => ({
    id: r.id,
    value: r.value,
    label: r.label,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    isDefault: r.isDefault,
    inUse: useMap.get(r.value) ?? 0,
  }));
}

export async function createCategory(label: string): Promise<Result> {
  const user = await requireCategoryManager();
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) {
    return { ok: false, error: "Enter a category name (1–40 characters)." };
  }
  const clean = parsed.data;

  const existing = await db
    .select({ value: ticketCategories.value, label: ticketCategories.label })
    .from(ticketCategories);
  if (existing.some((c) => c.label.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "A category with that name already exists." };
  }

  // Derive a unique slug (append a counter on collision).
  const base = slugify(clean) || "category";
  const taken = new Set(existing.map((c) => c.value));
  let value = base;
  let n = 2;
  while (taken.has(value)) value = `${base}_${n++}`;

  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${ticketCategories.sortOrder}), 0)` })
    .from(ticketCategories);
  const sortOrder = Number(maxRow?.max ?? 0) + 1;

  await db
    .insert(ticketCategories)
    .values({ value, label: clean, sortOrder, createdById: user.id });

  await audit({
    actorId: user.id,
    action: "category.create",
    targetType: "ticket_category",
    targetId: value,
    after: { value, label: clean },
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}

export async function renameCategory(
  id: string,
  label: string,
): Promise<Result> {
  const user = await requireCategoryManager();
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) {
    return { ok: false, error: "Enter a category name (1–40 characters)." };
  }
  const clean = parsed.data;

  const [current] = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Category not found." };

  const dup = await db
    .select({ id: ticketCategories.id })
    .from(ticketCategories)
    .where(
      and(
        ne(ticketCategories.id, id),
        sql`lower(${ticketCategories.label}) = ${clean.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, error: "A category with that name already exists." };
  }

  await db
    .update(ticketCategories)
    .set({ label: clean, updatedAt: new Date() })
    .where(eq(ticketCategories.id, id));

  await audit({
    actorId: user.id,
    action: "category.update",
    targetType: "ticket_category",
    targetId: current.value,
    before: { label: current.label },
    after: { label: clean },
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}

export async function setCategoryActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const user = await requireCategoryManager();
  const [current] = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Category not found." };

  if (!isActive && current.isDefault) {
    return {
      ok: false,
      error: "The default category can't be deactivated. Set another default first.",
    };
  }

  await db
    .update(ticketCategories)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(ticketCategories.id, id));

  await audit({
    actorId: user.id,
    action: "category.update",
    targetType: "ticket_category",
    targetId: current.value,
    before: { isActive: current.isActive },
    after: { isActive },
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}

export async function setDefaultCategory(id: string): Promise<Result> {
  const user = await requireCategoryManager();
  const [current] = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Category not found." };

  await transactional(async (tx) => {
    // Clear the existing default first (partial unique index allows only one).
    await tx
      .update(ticketCategories)
      .set({ isDefault: false })
      .where(eq(ticketCategories.isDefault, true));
    // The default must be selectable, so ensure it's active.
    await tx
      .update(ticketCategories)
      .set({ isDefault: true, isActive: true, updatedAt: new Date() })
      .where(eq(ticketCategories.id, id));
  });

  await audit({
    actorId: user.id,
    action: "category.set_default",
    targetType: "ticket_category",
    targetId: current.value,
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}

export async function moveCategory(
  id: string,
  direction: "up" | "down",
): Promise<Result> {
  await requireCategoryManager();
  const all = await db
    .select()
    .from(ticketCategories)
    .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label));
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return { ok: false, error: "Category not found." };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return { ok: true }; // already at the edge

  const a = all[idx];
  const b = all[swapIdx];
  await transactional(async (tx) => {
    await tx
      .update(ticketCategories)
      .set({ sortOrder: b.sortOrder })
      .where(eq(ticketCategories.id, a.id));
    await tx
      .update(ticketCategories)
      .set({ sortOrder: a.sortOrder })
      .where(eq(ticketCategories.id, b.id));
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  const user = await requireCategoryManager();
  const [current] = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Category not found." };

  if (current.isDefault) {
    return { ok: false, error: "The default category can't be deleted." };
  }

  const [used] = await db
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.category, current.value));
  if (Number(used?.n ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This category is used by existing tickets — deactivate it instead so those tickets keep their label.",
    };
  }

  await db.delete(ticketCategories).where(eq(ticketCategories.id, id));

  await audit({
    actorId: user.id,
    action: "category.delete",
    targetType: "ticket_category",
    targetId: current.value,
    before: { value: current.value, label: current.label },
  });

  revalidatePath("/admin/categories");
  return { ok: true };
}
