"use server";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { workLogs } from "@/lib/db/schema/work-logs";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { syncMonthlyPlanDeduction } from "@/lib/tickets/billing";
import { loadTicketScope } from "@/lib/tickets/load";

const SERVICE_TYPES = ["onsite", "remote"] as const;

const addSchema = z.object({
  description: z.string().trim().min(1, "Describe the work done").max(2000),
  // Duration in minutes; up to 24h per entry.
  minutes: z
    .number()
    .int()
    .positive("Time spent must be greater than zero")
    .max(1440, "A single entry can't exceed 24 hours"),
  serviceType: z.enum(SERVICE_TYPES),
});

export type AddWorkLogInput = z.infer<typeof addSchema>;
export type WorkLogResult = { ok: true } | { ok: false; error: string };

export async function addWorkLogEntry(
  ticketId: string,
  input: AddWorkLogInput,
): Promise<WorkLogResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const user = await requireSessionUser();
  await enforceUserRateLimit("authLogWork", user.id);
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.update",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  await transactional(async (tx) => {
    await tx.insert(workLogs).values({
      ticketId: ticket.id,
      technicianId: user.id,
      description: data.description,
      minutes: data.minutes,
      serviceType: data.serviceType,
      createdById: user.id,
    });
    // Keep the Monthly-Plan balance in sync (no-op unless the ticket is
    // billed as Monthly Plan against a plan organization).
    await syncMonthlyPlanDeduction(tx, ticket.id);
  });

  await audit({
    actorId: user.id,
    action: "ticket.log_work",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: {
      minutes: data.minutes,
      serviceType: data.serviceType,
    },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

export async function deleteWorkLogEntry(
  workLogId: string,
): Promise<WorkLogResult> {
  const user = await requireSessionUser();

  const [entry] = await db
    .select({
      id: workLogs.id,
      ticketId: workLogs.ticketId,
      minutes: workLogs.minutes,
    })
    .from(workLogs)
    .where(eq(workLogs.id, workLogId))
    .limit(1);
  if (!entry) throw new NotFoundError();

  const ticket = await loadTicketScope(entry.ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.update",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  await transactional(async (tx) => {
    await tx.delete(workLogs).where(eq(workLogs.id, workLogId));
    await syncMonthlyPlanDeduction(tx, entry.ticketId);
  });

  await audit({
    actorId: user.id,
    action: "ticket.delete_work_log",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { minutes: entry.minutes },
  });

  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true };
}

/** Work-log entries for a ticket, newest first, with the technician's name. */
export async function listWorkLogsForTicket(ticketId: string) {
  return db
    .select({
      id: workLogs.id,
      description: workLogs.description,
      minutes: workLogs.minutes,
      serviceType: workLogs.serviceType,
      createdAt: workLogs.createdAt,
      technicianId: workLogs.technicianId,
      technicianName: users.name,
    })
    .from(workLogs)
    .leftJoin(users, eq(workLogs.technicianId, users.id))
    .where(eq(workLogs.ticketId, ticketId))
    .orderBy(desc(workLogs.createdAt));
}
