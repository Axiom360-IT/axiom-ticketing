"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { isStrictRequester } from "@/lib/auth/can";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { getAppUrl } from "@/lib/request";
import { inngest } from "@/inngest/client";

// ── Types ─────────────────────────────────────────────────────────

const TYPES = ["hardware", "software", "other"] as const;
// Four single-select stages (Meeting-2, CR-26), in order.
const STAGES = [
  "awaiting_customer_payment",
  "order_pending",
  "order_placed",
  "order_completed",
] as const;
type Stage = (typeof STAGES)[number];

const createSchema = z.object({
  ticketId: z.string().uuid(),
  type: z.enum(TYPES),
  itemName: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(9999).default(1),
  // Optional (CR-23) — passed as string to keep numeric precision.
  estimatedCost: z
    .union([
      z.number().nonnegative(),
      z.string().trim().regex(/^\d+(\.\d{1,2})?$/),
    ])
    .optional(),
  vendor: z.string().trim().max(200).optional(),
  justification: z.string().trim().min(10).max(2000),
  // Mandatory (CR-22).
  dateNeededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A needed-by date is required"),
});

export type CreateProcurementInput = z.infer<typeof createSchema>;
export type CreateProcurementResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────

async function loadRequest(id: string) {
  const [r] = await db
    .select({
      id: procurementRequests.id,
      ticketId: procurementRequests.ticketId,
      requestedById: procurementRequests.requestedById,
      requestedByEmail: procurementRequests.requestedByEmail,
      type: procurementRequests.type,
      itemName: procurementRequests.itemName,
      quantity: procurementRequests.quantity,
      estimatedCost: procurementRequests.estimatedCost,
      vendor: procurementRequests.vendor,
      justification: procurementRequests.justification,
      dateNeededBy: procurementRequests.dateNeededBy,
      status: procurementRequests.status,
      createdAt: procurementRequests.createdAt,
    })
    .from(procurementRequests)
    .where(eq(procurementRequests.id, id))
    .limit(1);
  return r;
}

async function ticketSubject(ticketId: string): Promise<{
  ticketNumber: string;
  subject: string;
} | null> {
  const [t] = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return t ?? null;
}

// ── createProcurementRequest ─────────────────────────────────────

export async function createProcurementRequest(
  input: CreateProcurementInput,
): Promise<CreateProcurementResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const caller = await requireSessionUser();
  await enforceUserRateLimit("authCreateProcurement", caller.id);
  // procurement.create is global — every requester role holds it.
  if (
    !(await can(
      caller,
      "procurement.create",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const ticket = await ticketSubject(data.ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  const [author] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, caller.id))
    .limit(1);

  const estimated =
    typeof data.estimatedCost === "number"
      ? data.estimatedCost.toFixed(2)
      : (data.estimatedCost ?? null);

  const [row] = await db
    .insert(procurementRequests)
    .values({
      ticketId: data.ticketId,
      requestedById: caller.id,
      requestedByEmail: author?.email ?? "unknown",
      type: data.type,
      itemName: data.itemName,
      quantity: data.quantity,
      estimatedCost: estimated,
      vendor: data.vendor ?? null,
      justification: data.justification,
      dateNeededBy: data.dateNeededBy,
      status: "awaiting_customer_payment",
    })
    .returning({ id: procurementRequests.id });

  await audit({
    actorId: caller.id,
    action: "procurement.create",
    targetType: "procurement",
    targetId: row.id,
    after: {
      type: data.type,
      itemName: data.itemName,
      quantity: data.quantity,
      estimatedCost: estimated,
    },
  });

  // Notify Coordinators that a new request needs actioning (no approval step).
  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "procurement.submitted",
        recipientRoles: ["Coordinator"],
        ticketId: data.ticketId,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "procurement_submitted",
            data: {
              ticketNumber: ticket.ticketNumber,
              ticketSubject: ticket.subject,
              requesterName: author?.name ?? caller.id,
              itemName: data.itemName,
              quantity: data.quantity,
              adminUrl: `${getAppUrl()}/admin/procurement/${row.id}`,
            },
          },
        },
        inApp: {
          titleArgs: { itemName: data.itemName },
          bodyArgs: {
            requesterName: author?.name ?? caller.id,
            quantity: data.quantity,
            itemName: data.itemName,
          },
          linkUrl: `/admin/procurement/${row.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[createProcurementRequest] dispatch failed:", err);
  }

  revalidatePath(`/admin/tickets/${data.ticketId}`);
  revalidatePath("/admin/procurement");
  return { ok: true, requestId: row.id };
}

// ── setProcurementStatus (CR-24/26) ──────────────────────────────
//
// Replaces the approve/reject/mark-purchased/mark-delivered actions. The
// coordinator (procurement.manage) moves the request through the 4 stages.

export async function setProcurementStatus(
  requestId: string,
  status: Stage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STAGES.includes(status)) {
    return { ok: false, error: "Invalid procurement stage." };
  }
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.manage",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const r = await loadRequest(requestId);
  if (!r) throw new NotFoundError();
  if (r.status === status) return { ok: true };

  await db
    .update(procurementRequests)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(procurementRequests.id, requestId));

  await audit({
    actorId: caller.id,
    action: "procurement.set_status",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status },
  });

  // Tell the requester when the order is completed. Route through the
  // dispatcher (not a bare sendEmail) so the requester's notification
  // preferences are honored AND an in-app bell entry is created — a
  // procurement.delivered registry descriptor exists, but the previous direct
  // send bypassed both (req 6.3). Fall back to a direct email only when there
  // is no user account to target.
  if (status === "order_completed") {
    const ticket = await ticketSubject(r.ticketId);
    const ticketNumber = ticket?.ticketNumber ?? "";
    const adminUrl = `${getAppUrl()}/admin/procurement/${requestId}`;
    const deliveredEmail = {
      template: "procurement_delivered",
      data: {
        ticketNumber,
        itemName: r.itemName,
        quantity: r.quantity,
        adminUrl,
      },
    } as const;
    try {
      if (r.requestedById) {
        await inngest.send({
          name: "notification/dispatch",
          data: {
            type: "procurement.delivered",
            recipientUserIds: [r.requestedById],
            ticketId: r.ticketId,
            ticketNumber,
            email: { template: deliveredEmail },
            inApp: {
              titleArgs: { itemName: r.itemName },
              bodyArgs: { quantity: r.quantity, itemName: r.itemName },
              linkUrl: `/admin/procurement/${requestId}`,
            },
          },
        });
      } else if (r.requestedByEmail) {
        await sendEmail({ to: r.requestedByEmail, template: deliveredEmail });
      }
    } catch (err) {
      console.error("[setProcurementStatus] requester notify failed:", err);
    }
  }

  revalidatePath(`/admin/procurement/${requestId}`);
  revalidatePath("/admin/procurement");
  return { ok: true };
}

// ── Read helpers ─────────────────────────────────────────────────

export async function listProcurementForTicket(ticketId: string) {
  return db
    .select({
      id: procurementRequests.id,
      type: procurementRequests.type,
      itemName: procurementRequests.itemName,
      quantity: procurementRequests.quantity,
      estimatedCost: procurementRequests.estimatedCost,
      status: procurementRequests.status,
      requestedByEmail: procurementRequests.requestedByEmail,
      createdAt: procurementRequests.createdAt,
    })
    .from(procurementRequests)
    .where(eq(procurementRequests.ticketId, ticketId))
    .orderBy(desc(procurementRequests.createdAt));
}

export type ProcurementListFilters = {
  status?: string;
  type?: string;
};

export async function listProcurementForAdmin(
  filters: ProcurementListFilters & { page?: number; pageSize?: number },
) {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.view",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const where = [] as ReturnType<typeof eq>[];
  if (filters.status) where.push(eq(procurementRequests.status, filters.status));
  if (filters.type) where.push(eq(procurementRequests.type, filters.type));

  // Permission scope: requesters (everyone but Coordinator/Super Admin)
  // see only their own requests.
  if (isStrictRequester(caller)) {
    where.push(eq(procurementRequests.requestedById, caller.id));
  }

  const page = filters.page && filters.page >= 1 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize >= 1 ? filters.pageSize : 25;
  const limit = pageSize + 1;
  const offset = (page - 1) * pageSize;

  const rawRows = await db
    .select({
      id: procurementRequests.id,
      ticketId: procurementRequests.ticketId,
      type: procurementRequests.type,
      itemName: procurementRequests.itemName,
      quantity: procurementRequests.quantity,
      estimatedCost: procurementRequests.estimatedCost,
      status: procurementRequests.status,
      requestedByEmail: procurementRequests.requestedByEmail,
      createdAt: procurementRequests.createdAt,
    })
    .from(procurementRequests)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(procurementRequests.createdAt))
    .limit(limit)
    .offset(offset);

  const hasMore = rawRows.length > pageSize;
  return { items: rawRows.slice(0, pageSize), hasMore };
}

export async function getProcurementDetail(id: string) {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.view",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const r = await loadRequest(id);
  if (!r) return null;
  if (isStrictRequester(caller) && r.requestedById !== caller.id) {
    throw new ForbiddenError();
  }
  return r;
}
