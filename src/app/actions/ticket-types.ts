"use server";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { ticketTypes } from "@/lib/db/schema/ticket-types";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError } from "@/lib/errors";
import {
  isTicketTypeIconKey,
  suggestTicketTypeIcon,
} from "@/lib/tickets/type-icon-keys";

// Type management is admin configuration — gated on `settings.update`.
async function requireTypeManager(): Promise<{ id: string }> {
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

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type AdminTicketType = {
  id: string;
  value: string;
  label: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  inUse: number;
};

export async function listTypesForAdmin(): Promise<AdminTicketType[]> {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(ticketTypes)
      .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.label)),
    db
      .select({ value: tickets.type, n: count() })
      .from(tickets)
      .groupBy(tickets.type),
  ]);
  const useMap = new Map(usage.map((u) => [u.value, Number(u.n)]));
  return rows.map((r) => ({
    id: r.id,
    value: r.value,
    label: r.label,
    icon: r.icon,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    isDefault: r.isDefault,
    inUse: useMap.get(r.value) ?? 0,
  }));
}

export async function createType(
  label: string,
  icon?: string,
): Promise<Result> {
  const user = await requireTypeManager();
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) {
    return { ok: false, error: "Enter a type name (1–40 characters)." };
  }
  const clean = parsed.data;
  // Trust an explicit valid choice; otherwise suggest from the label rather
  // than fall back to the DB column default, so a MCP-created type (which
  // never sees the picker) still gets something relevant.
  const resolvedIcon =
    icon && isTicketTypeIconKey(icon) ? icon : suggestTicketTypeIcon(clean);

  const existing = await db
    .select({ value: ticketTypes.value, label: ticketTypes.label })
    .from(ticketTypes);
  if (existing.some((t) => t.label.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "A type with that name already exists." };
  }

  const base = slugify(clean) || "type";
  const taken = new Set(existing.map((t) => t.value));
  let value = base;
  let n = 2;
  while (taken.has(value)) value = `${base}_${n++}`;

  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${ticketTypes.sortOrder}), 0)` })
    .from(ticketTypes);
  const sortOrder = Number(maxRow?.max ?? 0) + 1;

  await db
    .insert(ticketTypes)
    .values({ value, label: clean, icon: resolvedIcon, sortOrder, createdById: user.id });

  await audit({
    actorId: user.id,
    action: "ticket_type.create",
    targetType: "ticket_type",
    targetId: value,
    after: { value, label: clean, icon: resolvedIcon },
  });

  revalidatePath("/admin/types");
  return { ok: true };
}

export async function renameType(
  id: string,
  label: string,
  icon?: string,
): Promise<Result> {
  const user = await requireTypeManager();
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) {
    return { ok: false, error: "Enter a type name (1–40 characters)." };
  }
  const clean = parsed.data;
  // Unlike create, an explicit valid icon is the ONLY way to change it here —
  // no re-suggesting from the (possibly just-edited) label, so renaming a
  // type never silently swaps out an icon the admin already chose.
  const resolvedIcon = icon && isTicketTypeIconKey(icon) ? icon : undefined;

  const [current] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Type not found." };

  const dup = await db
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(
      and(
        ne(ticketTypes.id, id),
        sql`lower(${ticketTypes.label}) = ${clean.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, error: "A type with that name already exists." };
  }

  await db
    .update(ticketTypes)
    .set({
      label: clean,
      ...(resolvedIcon ? { icon: resolvedIcon } : {}),
      updatedAt: new Date(),
    })
    .where(eq(ticketTypes.id, id));

  await audit({
    actorId: user.id,
    action: "ticket_type.update",
    targetType: "ticket_type",
    targetId: current.value,
    before: { label: current.label, ...(resolvedIcon ? { icon: current.icon } : {}) },
    after: { label: clean, ...(resolvedIcon ? { icon: resolvedIcon } : {}) },
  });

  revalidatePath("/admin/types");
  return { ok: true };
}

export async function setTypeActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const user = await requireTypeManager();
  const [current] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Type not found." };

  if (!isActive && current.isDefault) {
    return {
      ok: false,
      error: "The default type can't be deactivated. Set another default first.",
    };
  }

  await db
    .update(ticketTypes)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(ticketTypes.id, id));

  await audit({
    actorId: user.id,
    action: "ticket_type.update",
    targetType: "ticket_type",
    targetId: current.value,
    before: { isActive: current.isActive },
    after: { isActive },
  });

  revalidatePath("/admin/types");
  return { ok: true };
}

export async function setDefaultType(id: string): Promise<Result> {
  const user = await requireTypeManager();
  const [current] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Type not found." };

  await transactional(async (tx) => {
    await tx
      .update(ticketTypes)
      .set({ isDefault: false })
      .where(eq(ticketTypes.isDefault, true));
    await tx
      .update(ticketTypes)
      .set({ isDefault: true, isActive: true, updatedAt: new Date() })
      .where(eq(ticketTypes.id, id));
  });

  await audit({
    actorId: user.id,
    action: "ticket_type.set_default",
    targetType: "ticket_type",
    targetId: current.value,
  });

  revalidatePath("/admin/types");
  return { ok: true };
}

export async function moveType(
  id: string,
  direction: "up" | "down",
): Promise<Result> {
  await requireTypeManager();
  const all = await db
    .select()
    .from(ticketTypes)
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.label));
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: "Type not found." };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return { ok: true };

  const a = all[idx];
  const b = all[swapIdx];
  await transactional(async (tx) => {
    await tx
      .update(ticketTypes)
      .set({ sortOrder: b.sortOrder })
      .where(eq(ticketTypes.id, a.id));
    await tx
      .update(ticketTypes)
      .set({ sortOrder: a.sortOrder })
      .where(eq(ticketTypes.id, b.id));
  });

  revalidatePath("/admin/types");
  return { ok: true };
}

export async function deleteType(id: string): Promise<Result> {
  const user = await requireTypeManager();
  const [current] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Type not found." };

  if (current.isDefault) {
    return { ok: false, error: "The default type can't be deleted." };
  }

  const [used] = await db
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.type, current.value));
  if (Number(used?.n ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This type is used by existing tickets — deactivate it instead so those tickets keep their label.",
    };
  }

  await db.delete(ticketTypes).where(eq(ticketTypes.id, id));

  await audit({
    actorId: user.id,
    action: "ticket_type.delete",
    targetType: "ticket_type",
    targetId: current.value,
    before: { value: current.value, label: current.label },
  });

  revalidatePath("/admin/types");
  return { ok: true };
}
