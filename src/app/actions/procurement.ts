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
import { getSetting } from "@/lib/settings";
import { inngest } from "@/inngest/client";

class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

// ── Types ─────────────────────────────────────────────────────────

const TYPES = ["hardware", "software"] as const;
const URGENCIES = ["low", "medium", "high"] as const;

const createSchema = z.object({
  ticketId: z.string().uuid(),
  type: z.enum(TYPES),
  itemName: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(9999).default(1),
  // Numeric in DB; passed as string to keep precision intact.
  estimatedCost: z
    .union([
      z.number().nonnegative(),
      z.string().trim().regex(/^\d+(\.\d{1,2})?$/),
    ])
    .optional(),
  vendor: z.string().trim().max(200).optional(),
  justification: z.string().trim().min(10).max(2000),
  urgency: z.enum(URGENCIES),
  dateNeededBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
      urgency: procurementRequests.urgency,
      dateNeededBy: procurementRequests.dateNeededBy,
      status: procurementRequests.status,
      coordinatorDecisionAt: procurementRequests.coordinatorDecisionAt,
      adminDecisionAt: procurementRequests.adminDecisionAt,
      rejectionReason: procurementRequests.rejectionReason,
      rejectedAtStep: procurementRequests.rejectedAtStep,
      purchasedAt: procurementRequests.purchasedAt,
      deliveredAt: procurementRequests.deliveredAt,
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

function costNumber(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function aboveThreshold(cost: number, threshold: number): boolean {
  return threshold > 0 && cost >= threshold;
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

  // Resolve ticket so we can surface ticket number in emails.
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
      urgency: data.urgency,
      dateNeededBy: data.dateNeededBy ?? null,
      status: "pending_coordinator_approval",
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
      urgency: data.urgency,
    },
  });

  // Dispatch to Coordinators (the approval queue). Requester gets an
  // echo email kept inline because they don't need a row in their own
  // notifications table for an action they just took.
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
              urgency: data.urgency,
              adminUrl: `${appUrl()}/admin/procurement/${row.id}`,
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
    console.error(
      "[createProcurementRequest] dispatch failed:",
      err,
    );
  }
  if (author?.email) {
    try {
      await sendEmail({
        to: author.email,
        template: {
          template: "procurement_submitted",
          data: {
            ticketNumber: ticket.ticketNumber,
            ticketSubject: ticket.subject,
            requesterName: author.name ?? "",
            itemName: data.itemName,
            quantity: data.quantity,
            urgency: data.urgency,
            adminUrl: `${appUrl()}/admin/procurement/${row.id}`,
          },
        },
      });
    } catch (err) {
      console.error(
        "[createProcurementRequest] requester echo failed:",
        err,
      );
    }
  }

  revalidatePath(`/admin/tickets/${data.ticketId}`);
  revalidatePath("/admin/procurement");
  return { ok: true, requestId: row.id };
}

// ── approveProcurement ───────────────────────────────────────────

export async function approveProcurement(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.approve",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const r = await loadRequest(requestId);
  if (!r) throw new NotFoundError();
  if (r.status !== "pending_coordinator_approval" && r.status !== "pending_admin_approval") {
    return { ok: false, error: "Request is not awaiting approval." };
  }

  const threshold = costNumber(
    (await getSetting<string | number>("procurement_approval_threshold"))?.toString() ??
      null,
  );
  const cost = costNumber(r.estimatedCost);
  const needsAdminStep =
    aboveThreshold(cost, threshold) &&
    r.status === "pending_coordinator_approval" &&
    !caller.roleNames.has("Super Admin");

  const ticket = await ticketSubject(r.ticketId);

  if (needsAdminStep) {
    await db
      .update(procurementRequests)
      .set({
        status: "pending_admin_approval",
        coordinatorDecisionById: caller.id,
        coordinatorDecisionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(procurementRequests.id, requestId));
    await audit({
      actorId: caller.id,
      action: "procurement.coordinator_approve",
      targetType: "procurement",
      targetId: requestId,
      before: { status: r.status },
      after: { status: "pending_admin_approval" },
    });
    try {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "procurement.submitted",
          recipientRoles: ["Super Admin"],
          ticketId: r.ticketId,
          ticketNumber: ticket?.ticketNumber,
          email: {
            template: {
              template: "procurement_submitted",
              data: {
                ticketNumber: ticket?.ticketNumber ?? "",
                ticketSubject: ticket?.subject ?? "",
                requesterName: r.requestedByEmail,
                itemName: r.itemName,
                quantity: r.quantity,
                urgency: r.urgency,
                adminUrl: `${appUrl()}/admin/procurement/${requestId}`,
              },
            },
          },
          inApp: {
            titleArgs: { itemName: r.itemName },
            bodyArgs: {
              requesterName: r.requestedByEmail,
              quantity: r.quantity,
              itemName: r.itemName,
            },
            linkUrl: `/admin/procurement/${requestId}`,
          },
        },
      });
    } catch (err) {
      console.error("[approveProcurement] super admin dispatch failed:", err);
    }
    revalidatePath(`/admin/procurement/${requestId}`);
    revalidatePath("/admin/procurement");
    return { ok: true };
  }

  // Final approval (either single-step under threshold, or admin step).
  const wasAdminStep = r.status === "pending_admin_approval";
  await db
    .update(procurementRequests)
    .set({
      status: "approved",
      ...(wasAdminStep
        ? { adminDecisionById: caller.id, adminDecisionAt: new Date() }
        : {
            coordinatorDecisionById: caller.id,
            coordinatorDecisionAt: new Date(),
          }),
      updatedAt: new Date(),
    })
    .where(eq(procurementRequests.id, requestId));
  await audit({
    actorId: caller.id,
    action: wasAdminStep
      ? "procurement.admin_approve"
      : "procurement.coordinator_approve",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status: "approved" },
  });
  if (r.requestedByEmail) {
    try {
      await sendEmail({
        to: r.requestedByEmail,
        template: {
          template: "procurement_approved",
          data: {
            ticketNumber: ticket?.ticketNumber ?? "",
            itemName: r.itemName,
            quantity: r.quantity,
            adminUrl: `${appUrl()}/admin/procurement/${requestId}`,
          },
        },
      });
    } catch (err) {
      console.error("[approveProcurement] requester notify failed:", err);
    }
  }
  revalidatePath(`/admin/procurement/${requestId}`);
  revalidatePath("/admin/procurement");
  return { ok: true };
}

// ── rejectProcurement ────────────────────────────────────────────

const rejectSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
});

export async function rejectProcurement(
  requestId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = rejectSchema.safeParse({ reason });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reason",
    };
  }
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.reject",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const r = await loadRequest(requestId);
  if (!r) throw new NotFoundError();
  if (r.status !== "pending_coordinator_approval" && r.status !== "pending_admin_approval") {
    return { ok: false, error: "Request is not awaiting a decision." };
  }
  const step = r.status === "pending_admin_approval" ? "admin" : "coordinator";

  await db
    .update(procurementRequests)
    .set({
      status: "rejected",
      rejectionReason: parsed.data.reason,
      rejectedAtStep: step,
      updatedAt: new Date(),
      ...(step === "admin"
        ? { adminDecisionById: caller.id, adminDecisionAt: new Date() }
        : {
            coordinatorDecisionById: caller.id,
            coordinatorDecisionAt: new Date(),
          }),
    })
    .where(eq(procurementRequests.id, requestId));
  await audit({
    actorId: caller.id,
    action: "procurement.reject",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status: "rejected", step, reason: parsed.data.reason },
  });

  const ticket = await ticketSubject(r.ticketId);
  if (r.requestedByEmail) {
    try {
      await sendEmail({
        to: r.requestedByEmail,
        template: {
          template: "procurement_rejected",
          data: {
            ticketNumber: ticket?.ticketNumber ?? "",
            itemName: r.itemName,
            reason: parsed.data.reason,
            adminUrl: `${appUrl()}/admin/procurement/${requestId}`,
          },
        },
      });
    } catch (err) {
      console.error("[rejectProcurement] requester notify failed:", err);
    }
  }
  revalidatePath(`/admin/procurement/${requestId}`);
  revalidatePath("/admin/procurement");
  return { ok: true };
}

// ── markPurchased / markDelivered ────────────────────────────────

export async function markPurchased(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.mark_purchased",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const r = await loadRequest(requestId);
  if (!r) throw new NotFoundError();
  if (r.status !== "approved") {
    return { ok: false, error: "Only approved requests can be marked purchased." };
  }
  await db
    .update(procurementRequests)
    .set({
      status: "purchased",
      purchasedAt: new Date(),
      purchasedById: caller.id,
      updatedAt: new Date(),
    })
    .where(eq(procurementRequests.id, requestId));
  await audit({
    actorId: caller.id,
    action: "procurement.mark_purchased",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status: "purchased" },
  });
  revalidatePath(`/admin/procurement/${requestId}`);
  revalidatePath("/admin/procurement");
  return { ok: true };
}

export async function markDelivered(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "procurement.mark_delivered",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const r = await loadRequest(requestId);
  if (!r) throw new NotFoundError();
  if (r.status !== "purchased") {
    return { ok: false, error: "Only purchased requests can be marked delivered." };
  }
  await db
    .update(procurementRequests)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      deliveredById: caller.id,
      updatedAt: new Date(),
    })
    .where(eq(procurementRequests.id, requestId));
  await audit({
    actorId: caller.id,
    action: "procurement.mark_delivered",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status: "delivered" },
  });
  const ticket = await ticketSubject(r.ticketId);
  if (r.requestedByEmail) {
    try {
      await sendEmail({
        to: r.requestedByEmail,
        template: {
          template: "procurement_delivered",
          data: {
            ticketNumber: ticket?.ticketNumber ?? "",
            itemName: r.itemName,
            quantity: r.quantity,
            adminUrl: `${appUrl()}/admin/procurement/${requestId}`,
          },
        },
      });
    } catch (err) {
      console.error("[markDelivered] requester notify failed:", err);
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
      urgency: procurementRequests.urgency,
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
  urgency?: string;
};

export async function listProcurementForAdmin(
  filters: ProcurementListFilters,
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
  if (filters.urgency)
    where.push(eq(procurementRequests.urgency, filters.urgency));

  // Permission scope: requesters (everyone but Coordinator/Super Admin)
  // see only their own requests.
  if (isStrictRequester(caller)) {
    where.push(eq(procurementRequests.requestedById, caller.id));
  }

  const rows = await db
    .select({
      id: procurementRequests.id,
      ticketId: procurementRequests.ticketId,
      type: procurementRequests.type,
      itemName: procurementRequests.itemName,
      quantity: procurementRequests.quantity,
      estimatedCost: procurementRequests.estimatedCost,
      urgency: procurementRequests.urgency,
      status: procurementRequests.status,
      requestedByEmail: procurementRequests.requestedByEmail,
      createdAt: procurementRequests.createdAt,
    })
    .from(procurementRequests)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(procurementRequests.createdAt))
    .limit(200);

  return rows;
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
  if (
    isStrictRequester(caller) &&
    r.requestedById !== caller.id
  ) {
    throw new ForbiddenError();
  }
  return r;
}

// ── Helpers ──────────────────────────────────────────────────────

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
