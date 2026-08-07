import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { inngest } from "@/inngest/client";

// Mirrors app/actions/procurement.ts's mutating actions, adapted to take an
// explicit SessionUser and to resolve tickets by NUMBER instead of uuid.

const TYPES = ["hardware", "software", "other"] as const;
const STAGES = ["awaiting_customer_payment", "order_pending", "order_placed", "order_completed"] as const;
type Stage = (typeof STAGES)[number];

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function ticketByNumber(ticketNumber: string) {
  const [t] = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber.trim().toUpperCase()))
    .limit(1);
  return t ?? null;
}

async function loadRequest(id: string) {
  const [r] = await db
    .select({
      id: procurementRequests.id,
      ticketId: procurementRequests.ticketId,
      requestedById: procurementRequests.requestedById,
      requestedByEmail: procurementRequests.requestedByEmail,
      itemName: procurementRequests.itemName,
      quantity: procurementRequests.quantity,
      status: procurementRequests.status,
    })
    .from(procurementRequests)
    .where(eq(procurementRequests.id, id))
    .limit(1);
  return r ?? null;
}

// ── create_procurement_request ────────────────────────────────────────
// Mirrors createProcurementRequest (app/actions/procurement.ts ~111-221).
export async function createProcurementRequestViaMcp(
  user: SessionUser,
  input: {
    ticketNumber: string;
    type: (typeof TYPES)[number];
    itemName: string;
    quantity?: number;
    estimatedCost?: number;
    vendor?: string;
    justification: string;
    dateNeededBy: string;
  },
): Promise<Result> {
  if (!(await can(user, "procurement.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create procurement requests." };
  }
  const ticket = await ticketByNumber(input.ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${input.ticketNumber}.` };

  const [author] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
  const quantity = input.quantity ?? 1;
  const estimated = input.estimatedCost !== undefined ? input.estimatedCost.toFixed(2) : null;

  const [row] = await db
    .insert(procurementRequests)
    .values({
      ticketId: ticket.id,
      requestedById: user.id,
      requestedByEmail: author?.email ?? "unknown",
      type: input.type,
      itemName: input.itemName,
      quantity,
      estimatedCost: estimated,
      vendor: input.vendor ?? null,
      justification: input.justification,
      dateNeededBy: input.dateNeededBy,
      status: "awaiting_customer_payment",
    })
    .returning({ id: procurementRequests.id });

  await audit({
    actorId: user.id,
    action: "procurement.create",
    targetType: "procurement",
    targetId: row.id,
    after: { type: input.type, itemName: input.itemName, quantity, estimatedCost: estimated, via: "mcp" },
  });

  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "procurement.submitted",
        recipientRoles: ["Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "procurement_submitted",
            data: {
              ticketNumber: ticket.ticketNumber,
              ticketSubject: ticket.subject,
              requesterName: author?.name ?? user.id,
              itemName: input.itemName,
              quantity,
              adminUrl: `${getAppUrl()}/admin/procurement/${row.id}`,
            },
          },
        },
        inApp: {
          titleArgs: { itemName: input.itemName },
          bodyArgs: { requesterName: author?.name ?? user.id, quantity, itemName: input.itemName },
          linkUrl: `/admin/procurement/${row.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[createProcurementRequestViaMcp] dispatch failed:", err);
  }

  return { ok: true, requestId: row.id };
}

// ── set_procurement_status ────────────────────────────────────────────
// Mirrors setProcurementStatus (app/actions/procurement.ts ~228-314).
export async function setProcurementStatusViaMcp(
  user: SessionUser,
  requestId: string,
  status: Stage,
): Promise<Result> {
  if (!STAGES.includes(status)) return { ok: false, error: "Invalid procurement stage." };
  if (!(await can(user, "procurement.manage", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to manage procurement requests." };
  }
  const r = await loadRequest(requestId);
  if (!r) return { ok: false, error: "Procurement request not found." };
  if (r.status === status) return { ok: true };

  await db.update(procurementRequests).set({ status, updatedAt: new Date() }).where(eq(procurementRequests.id, requestId));

  await audit({
    actorId: user.id,
    action: "procurement.set_status",
    targetType: "procurement",
    targetId: requestId,
    before: { status: r.status },
    after: { status, via: "mcp" },
  });

  if (status === "order_completed") {
    const [t] = await db.select({ ticketNumber: tickets.ticketNumber }).from(tickets).where(eq(tickets.id, r.ticketId)).limit(1);
    const ticketNumber = t?.ticketNumber ?? "";
    const adminUrl = `${getAppUrl()}/admin/procurement/${requestId}`;
    const deliveredEmail = {
      template: "procurement_delivered",
      data: { ticketNumber, itemName: r.itemName, quantity: r.quantity, adminUrl },
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
      console.error("[setProcurementStatusViaMcp] requester notify failed:", err);
    }
  }

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
export function registerProcurementWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_procurement_request",
    {
      title: "Create a procurement request",
      description: "Creates a purchase request attached to a ticket. Notifies Coordinators." + CONFIRM_NOTE,
      inputSchema: {
        ticketNumber: z.string().min(1),
        type: z.enum(TYPES),
        itemName: z.string().min(1),
        quantity: z.number().int().positive().optional(),
        estimatedCost: z.number().nonnegative().optional(),
        vendor: z.string().optional(),
        justification: z.string().min(10),
        dateNeededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      },
    },
    async (input: {
      ticketNumber: string;
      type: (typeof TYPES)[number];
      itemName: string;
      quantity?: number;
      estimatedCost?: number;
      vendor?: string;
      justification: string;
      dateNeededBy: string;
    }) => {
      const r = await createProcurementRequestViaMcp(user, input);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "set_procurement_status",
    {
      title: "Set a procurement request's stage",
      description:
        "Moves a procurement request through its 4-stage pipeline (awaiting_customer_payment -> order_pending -> order_placed -> order_completed). Find the request id via the get_procurement_status read tool." +
        CONFIRM_NOTE,
      inputSchema: { requestId: z.string().uuid(), status: z.enum(STAGES) },
    },
    async ({ requestId, status }: { requestId: string; status: Stage }) => {
      const r = await setProcurementStatusViaMcp(user, requestId, status);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
