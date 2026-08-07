import "server-only";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db, transactional } from "@/lib/db/client";
import { ticketCategories } from "@/lib/db/schema/ticket-categories";
import { ticketTypes } from "@/lib/db/schema/ticket-types";
import { tickets } from "@/lib/db/schema/tickets";

// Mirrors app/actions/categories.ts and app/actions/ticket-types.ts (near-
// identical shape in both), adapted to take an explicit SessionUser and to
// look categories/types up by LABEL instead of uuid. Reordering
// (moveCategory/moveType) is UI-only and skipped here — no MCP tool for it.

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };
const labelSchema = z.string().trim().min(1).max(40);

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

async function requireManager(user: SessionUser): Promise<Result | null> {
  if (!(await can(user, "settings.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to manage categories/types." };
  }
  return null;
}

// ═══════════════════════ Ticket categories ═══════════════════════════════
// Mirrors app/actions/categories.ts.

async function findCategoryByLabel(label: string) {
  const [row] = await db.select().from(ticketCategories).where(sql`lower(${ticketCategories.label}) = lower(${label})`).limit(1);
  return row ?? null;
}

export async function createTicketCategoryViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) return { ok: false, error: "Enter a category name (1-40 characters)." };
  const clean = parsed.data;

  const existing = await db.select({ value: ticketCategories.value, label: ticketCategories.label }).from(ticketCategories);
  if (existing.some((c) => c.label.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "A category with that name already exists." };
  }
  const base = slugify(clean) || "category";
  const taken = new Set(existing.map((c) => c.value));
  let value = base;
  let n = 2;
  while (taken.has(value)) value = `${base}_${n++}`;

  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(${ticketCategories.sortOrder}), 0)` }).from(ticketCategories);
  const sortOrder = Number(maxRow?.max ?? 0) + 1;

  await db.insert(ticketCategories).values({ value, label: clean, sortOrder, createdById: user.id });
  await audit({ actorId: user.id, action: "category.create", targetType: "ticket_category", targetId: value, after: { value, label: clean, via: "mcp" } });
  return { ok: true, value };
}

export async function renameTicketCategoryViaMcp(user: SessionUser, currentLabel: string, newLabel: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const parsed = labelSchema.safeParse(newLabel);
  if (!parsed.success) return { ok: false, error: "Enter a category name (1-40 characters)." };
  const clean = parsed.data;
  const current = await findCategoryByLabel(currentLabel);
  if (!current) return { ok: false, error: `No category found named "${currentLabel}".` };

  const dup = await db
    .select({ id: ticketCategories.id })
    .from(ticketCategories)
    .where(and(ne(ticketCategories.id, current.id), sql`lower(${ticketCategories.label}) = ${clean.toLowerCase()}`))
    .limit(1);
  if (dup.length > 0) return { ok: false, error: "A category with that name already exists." };

  await db.update(ticketCategories).set({ label: clean, updatedAt: new Date() }).where(eq(ticketCategories.id, current.id));
  await audit({
    actorId: user.id,
    action: "category.update",
    targetType: "ticket_category",
    targetId: current.value,
    before: { label: current.label },
    after: { label: clean, via: "mcp" },
  });
  return { ok: true };
}

export async function setTicketCategoryActiveViaMcp(user: SessionUser, label: string, isActive: boolean): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findCategoryByLabel(label);
  if (!current) return { ok: false, error: `No category found named "${label}".` };
  if (!isActive && current.isDefault) {
    return { ok: false, error: "The default category can't be deactivated. Set another default first." };
  }
  await db.update(ticketCategories).set({ isActive, updatedAt: new Date() }).where(eq(ticketCategories.id, current.id));
  await audit({
    actorId: user.id,
    action: "category.update",
    targetType: "ticket_category",
    targetId: current.value,
    before: { isActive: current.isActive },
    after: { isActive, via: "mcp" },
  });
  return { ok: true };
}

export async function setDefaultTicketCategoryViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findCategoryByLabel(label);
  if (!current) return { ok: false, error: `No category found named "${label}".` };
  await transactional(async (tx) => {
    await tx.update(ticketCategories).set({ isDefault: false }).where(eq(ticketCategories.isDefault, true));
    await tx.update(ticketCategories).set({ isDefault: true, isActive: true, updatedAt: new Date() }).where(eq(ticketCategories.id, current.id));
  });
  await audit({ actorId: user.id, action: "category.set_default", targetType: "ticket_category", targetId: current.value, after: { via: "mcp" } });
  return { ok: true };
}

export async function deleteTicketCategoryViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findCategoryByLabel(label);
  if (!current) return { ok: false, error: `No category found named "${label}".` };
  if (current.isDefault) return { ok: false, error: "The default category can't be deleted." };

  const [used] = await db.select({ n: count() }).from(tickets).where(eq(tickets.category, current.value));
  if (Number(used?.n ?? 0) > 0) {
    return { ok: false, error: "This category is used by existing tickets — deactivate it instead so those tickets keep their label." };
  }
  await db.delete(ticketCategories).where(eq(ticketCategories.id, current.id));
  await audit({
    actorId: user.id,
    action: "category.delete",
    targetType: "ticket_category",
    targetId: current.value,
    before: { value: current.value, label: current.label },
    after: { via: "mcp" },
  });
  return { ok: true };
}

// ═══════════════════════ Ticket types ═════════════════════════════════════
// Mirrors app/actions/ticket-types.ts.

async function findTypeByLabel(label: string) {
  const [row] = await db.select().from(ticketTypes).where(sql`lower(${ticketTypes.label}) = lower(${label})`).limit(1);
  return row ?? null;
}

export async function createTicketTypeViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) return { ok: false, error: "Enter a type name (1-40 characters)." };
  const clean = parsed.data;

  const existing = await db.select({ value: ticketTypes.value, label: ticketTypes.label }).from(ticketTypes);
  if (existing.some((t) => t.label.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "A type with that name already exists." };
  }
  const base = slugify(clean) || "type";
  const taken = new Set(existing.map((t) => t.value));
  let value = base;
  let n = 2;
  while (taken.has(value)) value = `${base}_${n++}`;

  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(${ticketTypes.sortOrder}), 0)` }).from(ticketTypes);
  const sortOrder = Number(maxRow?.max ?? 0) + 1;

  await db.insert(ticketTypes).values({ value, label: clean, sortOrder, createdById: user.id });
  await audit({ actorId: user.id, action: "ticket_type.create", targetType: "ticket_type", targetId: value, after: { value, label: clean, via: "mcp" } });
  return { ok: true, value };
}

export async function renameTicketTypeViaMcp(user: SessionUser, currentLabel: string, newLabel: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const parsed = labelSchema.safeParse(newLabel);
  if (!parsed.success) return { ok: false, error: "Enter a type name (1-40 characters)." };
  const clean = parsed.data;
  const current = await findTypeByLabel(currentLabel);
  if (!current) return { ok: false, error: `No type found named "${currentLabel}".` };

  const dup = await db
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(and(ne(ticketTypes.id, current.id), sql`lower(${ticketTypes.label}) = ${clean.toLowerCase()}`))
    .limit(1);
  if (dup.length > 0) return { ok: false, error: "A type with that name already exists." };

  await db.update(ticketTypes).set({ label: clean, updatedAt: new Date() }).where(eq(ticketTypes.id, current.id));
  await audit({
    actorId: user.id,
    action: "ticket_type.update",
    targetType: "ticket_type",
    targetId: current.value,
    before: { label: current.label },
    after: { label: clean, via: "mcp" },
  });
  return { ok: true };
}

export async function setTicketTypeActiveViaMcp(user: SessionUser, label: string, isActive: boolean): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findTypeByLabel(label);
  if (!current) return { ok: false, error: `No type found named "${label}".` };
  if (!isActive && current.isDefault) {
    return { ok: false, error: "The default type can't be deactivated. Set another default first." };
  }
  await db.update(ticketTypes).set({ isActive, updatedAt: new Date() }).where(eq(ticketTypes.id, current.id));
  await audit({
    actorId: user.id,
    action: "ticket_type.update",
    targetType: "ticket_type",
    targetId: current.value,
    before: { isActive: current.isActive },
    after: { isActive, via: "mcp" },
  });
  return { ok: true };
}

export async function setDefaultTicketTypeViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findTypeByLabel(label);
  if (!current) return { ok: false, error: `No type found named "${label}".` };
  await transactional(async (tx) => {
    await tx.update(ticketTypes).set({ isDefault: false }).where(eq(ticketTypes.isDefault, true));
    await tx.update(ticketTypes).set({ isDefault: true, isActive: true, updatedAt: new Date() }).where(eq(ticketTypes.id, current.id));
  });
  await audit({ actorId: user.id, action: "ticket_type.set_default", targetType: "ticket_type", targetId: current.value, after: { via: "mcp" } });
  return { ok: true };
}

export async function deleteTicketTypeViaMcp(user: SessionUser, label: string): Promise<Result> {
  const denied = await requireManager(user);
  if (denied) return denied;
  const current = await findTypeByLabel(label);
  if (!current) return { ok: false, error: `No type found named "${label}".` };
  if (current.isDefault) return { ok: false, error: "The default type can't be deleted." };

  const [used] = await db.select({ n: count() }).from(tickets).where(eq(tickets.type, current.value));
  if (Number(used?.n ?? 0) > 0) {
    return { ok: false, error: "This type is used by existing tickets — deactivate it instead so those tickets keep their label." };
  }
  await db.delete(ticketTypes).where(eq(ticketTypes.id, current.id));
  await audit({
    actorId: user.id,
    action: "ticket_type.delete",
    targetType: "ticket_type",
    targetId: current.value,
    before: { value: current.value, label: current.label },
    after: { via: "mcp" },
  });
  return { ok: true };
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
export function registerCategoryTypeWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_ticket_category",
    { title: "Create a ticket category", description: "Creates a new ticket category." + CONFIRM_NOTE, inputSchema: { label: z.string().min(1) } },
    async ({ label }: { label: string }) => {
      const r = await createTicketCategoryViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "rename_ticket_category",
    {
      title: "Rename a ticket category",
      description: "Renames a ticket category (find it by its current name)." + CONFIRM_NOTE,
      inputSchema: { currentLabel: z.string().min(1), newLabel: z.string().min(1) },
    },
    async ({ currentLabel, newLabel }: { currentLabel: string; newLabel: string }) => {
      const r = await renameTicketCategoryViaMcp(user, currentLabel, newLabel);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "set_ticket_category_active",
    {
      title: "Activate/deactivate a ticket category",
      description: "Turns a ticket category on or off (the default category can't be deactivated)." + CONFIRM_NOTE,
      inputSchema: { label: z.string().min(1), isActive: z.boolean() },
    },
    async ({ label, isActive }: { label: string; isActive: boolean }) => {
      const r = await setTicketCategoryActiveViaMcp(user, label, isActive);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "set_default_ticket_category",
    { title: "Set the default ticket category", description: "Makes a category the default (and activates it if needed)." + CONFIRM_NOTE, inputSchema: { label: z.string().min(1) } },
    async ({ label }: { label: string }) => {
      const r = await setDefaultTicketCategoryViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "delete_ticket_category",
    {
      title: "Delete a ticket category",
      description: "Deletes a ticket category. Refused if it's the default or still used by any ticket." + CONFIRM_NOTE,
      inputSchema: { label: z.string().min(1) },
    },
    async ({ label }: { label: string }) => {
      const r = await deleteTicketCategoryViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "create_ticket_type",
    { title: "Create a ticket type", description: "Creates a new ticket type." + CONFIRM_NOTE, inputSchema: { label: z.string().min(1) } },
    async ({ label }: { label: string }) => {
      const r = await createTicketTypeViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "rename_ticket_type",
    {
      title: "Rename a ticket type",
      description: "Renames a ticket type (find it by its current name)." + CONFIRM_NOTE,
      inputSchema: { currentLabel: z.string().min(1), newLabel: z.string().min(1) },
    },
    async ({ currentLabel, newLabel }: { currentLabel: string; newLabel: string }) => {
      const r = await renameTicketTypeViaMcp(user, currentLabel, newLabel);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "set_ticket_type_active",
    {
      title: "Activate/deactivate a ticket type",
      description: "Turns a ticket type on or off (the default type can't be deactivated)." + CONFIRM_NOTE,
      inputSchema: { label: z.string().min(1), isActive: z.boolean() },
    },
    async ({ label, isActive }: { label: string; isActive: boolean }) => {
      const r = await setTicketTypeActiveViaMcp(user, label, isActive);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "set_default_ticket_type",
    { title: "Set the default ticket type", description: "Makes a type the default (and activates it if needed)." + CONFIRM_NOTE, inputSchema: { label: z.string().min(1) } },
    async ({ label }: { label: string }) => {
      const r = await setDefaultTicketTypeViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
  server.registerTool(
    "delete_ticket_type",
    {
      title: "Delete a ticket type",
      description: "Deletes a ticket type. Refused if it's the default or still used by any ticket." + CONFIRM_NOTE,
      inputSchema: { label: z.string().min(1) },
    },
    async ({ label }: { label: string }) => {
      const r = await deleteTicketTypeViaMcp(user, label);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
