import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/can";
import {
  addTicketNoteViaMcp,
  getTicketByNumber,
  getTicketStats,
  listEscalatedTickets,
  listOverdueTickets,
  listProcurementByStatus,
  listTicketsByStatus,
  listUnassignedTickets,
  searchCustomerOrOrgHistory,
} from "./queries";
import { registerTicketWriteTools } from "./tickets-write";
import { registerUserWriteTools } from "./users-write";
import { registerRoleWriteTools } from "./roles-write";
import { registerOrganizationWriteTools } from "./organizations-write";
import { registerProcurementWriteTools } from "./procurement-write";
import { registerSettingsWriteTools } from "./settings-write";
import { registerCategoryTypeWriteTools } from "./categories-types-write";
import { registerAuditReadTools } from "./audit-write";

const TICKET_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
  "escalation",
  "resolved",
  "closed",
] as const;

const PROCUREMENT_STATUSES = [
  "awaiting_customer_payment",
  "order_pending",
  "order_placed",
  "order_completed",
] as const;

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Builds a fresh MCP server bound to one already-authenticated user. A new
 * instance is created per request (stateless — matches Vercel's serverless
 * model, and every tool call re-validates permissions on its own anyway, so
 * nothing is lost by not persisting server state between requests).
 *
 * Every tool here is read-only except `add_ticket_note`, which only ever
 * posts an INTERNAL note (staff-only, customer never sees it) — never a
 * customer-facing reply. Claude is instructed (via the tool description) to
 * always show the user the exact text and get their go-ahead in the chat
 * before calling it — that's the "confirm before send" behavior, enforced
 * by instruction rather than a multi-step protocol, since the human is
 * already in the loop for every message in the conversation.
 */
export function buildMcpServer(user: SessionUser): McpServer {
  const server = new McpServer({ name: "axiom-ticketing", version: "1.0.0" });

  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description:
        "Look up a single ticket by its number (e.g. AX-0042). Returns status, priority, assignee, customer/organization, and SLA due date.",
      inputSchema: { ticketNumber: z.string().min(1) },
    },
    async ({ ticketNumber }) => {
      try {
        const ticket = await getTicketByNumber(user, ticketNumber);
        return ticket
          ? textResult(ticket)
          : errorResult(`No ticket found with number ${ticketNumber}, or you don't have access to it.`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "list_tickets_by_status",
    {
      title: "List tickets by status",
      description:
        "List tickets in one or more statuses (open, in_progress, awaiting_customer_confirmation, on_hold, escalation, resolved, closed).",
      inputSchema: {
        statuses: z.array(z.enum(TICKET_STATUSES)).min(1),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ statuses, limit }) => {
      try {
        return textResult(await listTicketsByStatus(user, statuses, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "list_overdue_tickets",
    {
      title: "List overdue tickets",
      description:
        "List open tickets that are past their SLA resolution due date and not yet resolved/closed — 'what's overdue right now.'",
      inputSchema: { limit: z.number().int().positive().max(50).optional() },
    },
    async ({ limit }) => {
      try {
        return textResult(await listOverdueTickets(user, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "list_unassigned_tickets",
    {
      title: "List unassigned tickets",
      description: "List open tickets that have no technician assigned yet.",
      inputSchema: { limit: z.number().int().positive().max(50).optional() },
    },
    async ({ limit }) => {
      try {
        return textResult(await listUnassignedTickets(user, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "list_escalated_tickets",
    {
      title: "List escalated tickets",
      description: "List tickets currently flagged as escalated, needing senior attention.",
      inputSchema: { limit: z.number().int().positive().max(50).optional() },
    },
    async ({ limit }) => {
      try {
        return textResult(await listEscalatedTickets(user, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "get_ticket_stats",
    {
      title: "Get ticket stats",
      description:
        "Quick counts: open, unassigned, awaiting customer, on hold, escalated, resolved — 'how are we doing right now.'",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await getTicketStats(user));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "get_customer_or_org_history",
    {
      title: "Get customer or organization ticket history",
      description:
        "Search tickets by a customer's name/email or an organization's name — 'how many tickets has this company had.'",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      try {
        return textResult(await searchCustomerOrOrgHistory(user, query, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "get_procurement_status",
    {
      title: "Get procurement request status",
      description:
        "List purchase/procurement requests, optionally filtered by stage (awaiting_customer_payment, order_pending, order_placed, order_completed).",
      inputSchema: {
        statuses: z.array(z.enum(PROCUREMENT_STATUSES)).optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ statuses, limit }) => {
      try {
        return textResult(await listProcurementByStatus(user, statuses, limit));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Lookup failed.");
      }
    },
  );

  server.registerTool(
    "add_ticket_note",
    {
      title: "Add an internal note to a ticket",
      description:
        "Posts an INTERNAL note on a ticket — visible to staff only, the customer never sees it and is never emailed. " +
        "This is NOT a customer reply. Before calling this tool, ALWAYS show the user the exact text you're about to " +
        "post and get their explicit go-ahead in the chat first — never call it on the first ask.",
      inputSchema: { ticketNumber: z.string().min(1), note: z.string().min(1) },
    },
    async ({ ticketNumber, note }) => {
      try {
        const result = await addTicketNoteViaMcp(user, ticketNumber, note);
        return result.ok
          ? textResult({ posted: true, ticketNumber })
          : errorResult(result.error);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Could not post the note.");
      }
    },
  );

  // Full create/edit/delete surface — tickets, users, roles, organizations,
  // procurement, settings/notifications, categories/types, plus an audit
  // summary read tool. Every mutating tool below re-runs the exact same
  // can() permission checks and business-rule guards as the admin panel's
  // Server Action it mirrors — see each module's file-top comment.
  registerTicketWriteTools(server, user);
  registerUserWriteTools(server, user);
  registerRoleWriteTools(server, user);
  registerOrganizationWriteTools(server, user);
  registerProcurementWriteTools(server, user);
  registerSettingsWriteTools(server, user);
  registerCategoryTypeWriteTools(server, user);
  registerAuditReadTools(server, user);

  return server;
}
