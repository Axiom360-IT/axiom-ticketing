import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { inngest } from "@/inngest/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { organizationTrustedEmails } from "@/lib/db/schema/organization-trusted-emails";
import { roles } from "@/lib/db/schema/rbac";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { getAppUrl } from "@/lib/request";
import { MUTATING_ACTIONS } from "./types";
import {
  defaultSubjectLine,
  type RenderContext,
  renderMessage,
  renderSms,
} from "./render";
import type { FactSheet, RuleAction } from "./types";

// ── Doing the things ──────────────────────────────────────────────────
//
// The only module in the engine that touches the outside world. Kept as thin
// as it can be: everything decidable was decided in `evaluate.ts`, which is
// why that file has 54 tests and this one has none worth writing without a
// database.
//
// PHASE 1 IS SAFE-ACTIONS-ONLY. `assertSafe` is the gate, not a convention —
// a mutating action in a stored rule is refused here even if it somehow got
// past zod, because the chain-depth guard has not been observed working in
// production yet (see docs/automation-rules.md §8).
//
// Every executor returns an outcome rather than throwing. One failing action
// must not abandon the others: a rule that texts the on-call technician AND
// posts a note should still post the note when the SMS gateway is down.

export type ActionOutcome = {
  actionType: string;
  outcome: "ok" | "skipped" | "error";
  detail?: string;
  error?: string;
};

export type ExecuteContext = {
  ruleId: string;
  ruleName: string;
  triggerKey: string;
  facts: FactSheet;
  /** Resolved display names, so `render.ts` can stay pure. */
  assigneeName: string | null;
  customerName: string | null;
  now: Date;
};

function ticketUrl(ticketId: string): string {
  return `${getAppUrl()}/admin/tickets/${ticketId}`;
}

function renderCtx(ctx: ExecuteContext): RenderContext {
  return {
    facts: ctx.facts,
    assigneeName: ctx.assigneeName,
    customerName: ctx.customerName,
    ruleName: ctx.ruleName,
    url: ticketUrl(ctx.facts.ticket.id),
  };
}

/** Phase-1 gate. A stored rule can predate the catalog; this is the backstop. */
function assertSafe(action: RuleAction): string | null {
  return MUTATING_ACTIONS.has(action.type)
    ? `"${action.type}" changes a ticket, and the engine is not allowed to do that yet.`
    : null;
}

export async function runAction(
  action: RuleAction,
  ctx: ExecuteContext,
): Promise<ActionOutcome> {
  const blocked = assertSafe(action);
  if (blocked) {
    return { actionType: action.type, outcome: "skipped", detail: blocked };
  }

  try {
    switch (action.type) {
      case "notify":
        return await doNotify(action, ctx);
      case "internal_note":
        return await doInternalNote(action, ctx);
      case "flag":
        return await doFlag(action, ctx);
      case "webhook":
        return await doWebhook(action, ctx);
      default:
        return {
          actionType: action.type,
          outcome: "skipped",
          detail: "This action is not available yet.",
        };
    }
  } catch (err) {
    console.error(`[rules] action ${action.type} failed:`, err);
    return {
      actionType: action.type,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── notify ────────────────────────────────────────────────────────────

type ResolvedAudience = {
  userIds: string[];
  roleNames: string[];
  /** Addresses with no user account behind them: literal entries the operator
   *  typed, the customer on a guest ticket, trusted contacts, participants. */
  looseEmails: string[];
  /** Audiences that resolved to nobody, so the log can say which. */
  empty: string[];
};

async function resolveAudience(
  action: Extract<RuleAction, { type: "notify" }>,
  ctx: ExecuteContext,
): Promise<ResolvedAudience> {
  const t = ctx.facts.ticket;
  const out: ResolvedAudience = {
    userIds: [],
    roleNames: [],
    looseEmails: [],
    empty: [],
  };

  for (const audience of action.audiences) {
    switch (audience) {
      case "assignee":
        if (t.assignedToId) out.userIds.push(t.assignedToId);
        else out.empty.push("nobody owns it");
        break;

      case "customer": {
        // A ticket raised by a guest has no account, so there is no
        // preference row and no in-app bell — the address is all there is.
        const [row] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, t.customerEmail.toLowerCase()))
          .limit(1);
        if (row) out.userIds.push(row.id);
        else out.looseEmails.push(t.customerEmail);
        break;
      }

      case "org_trusted_contacts": {
        if (!t.organizationId) {
          out.empty.push("the ticket has no client");
          break;
        }
        const rows = await db
          .select({ email: organizationTrustedEmails.email })
          .from(organizationTrustedEmails)
          .where(eq(organizationTrustedEmails.organizationId, t.organizationId));
        if (rows.length === 0) out.empty.push("that client has no contacts");
        out.looseEmails.push(...rows.map((r) => r.email));
        break;
      }

      case "participants": {
        const rows = await db
          .select({ email: ticketParticipants.email })
          .from(ticketParticipants)
          .where(
            and(
              eq(ticketParticipants.ticketId, t.id),
              eq(ticketParticipants.status, "active"),
            ),
          );
        if (rows.length === 0) out.empty.push("nobody else is on the ticket");
        out.looseEmails.push(...rows.map((r) => r.email));
        break;
      }

      case "escalation_target_role":
        if (t.escalationTargetRole) out.roleNames.push(t.escalationTargetRole);
        else out.empty.push("it is not escalated to anyone");
        break;

      case "named_users":
        out.userIds.push(...(action.userIds ?? []));
        break;

      case "named_roles":
        out.roleNames.push(...(action.roles ?? []));
        break;

      case "named_emails":
        out.looseEmails.push(...(action.emails ?? []));
        break;
    }
  }

  // A named user who has since been deactivated must not silently absorb the
  // notification (invariant I5): drop them and say so.
  if (out.userIds.length > 0) {
    const ids = [...new Set(out.userIds)];
    const active = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isActive, true)));
    const activeSet = new Set(active.map((u) => u.id));
    const dropped = ids.filter((id) => !activeSet.has(id));
    if (dropped.length > 0) {
      out.empty.push(`${dropped.length} chosen account(s) are no longer active`);
    }
    out.userIds = [...activeSet];
  }

  // Likewise a role that was renamed or deleted.
  if (out.roleNames.length > 0) {
    const names = [...new Set(out.roleNames)];
    const found = await db
      .select({ name: roles.name })
      .from(roles)
      .where(inArray(roles.name, names));
    const foundSet = new Set(found.map((r) => r.name));
    const missing = names.filter((n) => !foundSet.has(n));
    if (missing.length > 0) {
      out.empty.push(`no such role: ${missing.join(", ")}`);
    }
    out.roleNames = [...foundSet];
  }

  // De-dupe addresses against the accounts we already resolved, so somebody
  // who is both a participant and a named user gets one email, not two.
  if (out.looseEmails.length > 0) {
    const unique = [...new Set(out.looseEmails.map((e) => e.toLowerCase()))];
    if (out.userIds.length > 0) {
      const known = await db
        .select({ email: users.email })
        .from(users)
        .where(inArray(users.id, out.userIds));
      const knownSet = new Set(known.map((u) => u.email.toLowerCase()));
      out.looseEmails = unique.filter((e) => !knownSet.has(e));
    } else {
      out.looseEmails = unique;
    }
  }

  return out;
}

async function doNotify(
  action: Extract<RuleAction, { type: "notify" }>,
  ctx: ExecuteContext,
): Promise<ActionOutcome> {
  const rc = renderCtx(ctx);
  const message = renderMessage(action.body, rc);
  const subjectLine = action.subject
    ? renderMessage(action.subject, rc)
    : defaultSubjectLine(rc);
  const t = ctx.facts.ticket;
  const url = ticketUrl(t.id);

  const who = await resolveAudience(action, ctx);
  const wantsEmail = action.channels.includes("email");
  const wantsSms = action.channels.includes("sms");
  const wantsInApp = action.channels.includes("in_app");

  const notes: string[] = [];
  let sent = 0;

  // ── Accounts and roles go through the dispatcher ──
  //
  // It resolves roles to people, honours each recipient's channel
  // preferences, and writes the in-app row. Rebuilding any of that here would
  // be a second, worse copy of req 6.x.
  if (who.userIds.length > 0 || who.roleNames.length > 0) {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "automation.rule",
        recipientUserIds: who.userIds.length > 0 ? who.userIds : undefined,
        recipientRoles: who.roleNames.length > 0 ? who.roleNames : undefined,
        ...(wantsEmail
          ? {
              email: {
                template: {
                  template: "automation_rule" as const,
                  data: {
                    ruleName: ctx.ruleName,
                    subjectLine,
                    message,
                    ticketNumber: t.ticketNumber,
                    ticketSubject: t.subject,
                    adminUrl: url,
                  },
                },
                ticketNumber: t.ticketNumber,
              },
            }
          : {}),
        ...(wantsSms
          ? {
              sms: {
                template: {
                  template: "automation_rule" as const,
                  data: { message: renderSms(message, url) },
                },
              },
            }
          : {}),
        ...(wantsInApp
          ? {
              inApp: {
                titleArgs: { title: subjectLine },
                bodyArgs: { message },
                linkUrl: `/admin/tickets/${t.id}`,
              },
            }
          : {}),
      },
    });
    sent += who.userIds.length + who.roleNames.length;
    notes.push(
      `${who.userIds.length} account(s), ${who.roleNames.length} role(s)`,
    );
  }

  // ── Loose addresses get email only ──
  //
  // There is no account behind them, so there is no phone number and no bell
  // to ring. Saying so in the log beats letting an operator believe a text
  // went to an address.
  if (who.looseEmails.length > 0) {
    if (wantsEmail) {
      for (const to of who.looseEmails) {
        await inngest.send({
          name: "notification/email",
          data: {
            to,
            locale: "en",
            template: {
              template: "automation_rule",
              data: {
                ruleName: ctx.ruleName,
                subjectLine,
                message,
                ticketNumber: t.ticketNumber,
                ticketSubject: t.subject,
                adminUrl: url,
              },
            },
            ticketNumber: t.ticketNumber,
          },
        });
      }
      sent += who.looseEmails.length;
      notes.push(`${who.looseEmails.length} address(es) by email`);
    } else {
      notes.push(
        `${who.looseEmails.length} address(es) skipped — they have no account, so only email can reach them`,
      );
    }
  }

  if (sent === 0) {
    return {
      actionType: "notify",
      outcome: "skipped",
      detail:
        who.empty.length > 0
          ? `Nobody to tell: ${who.empty.join("; ")}`
          : "Nobody to tell.",
    };
  }

  return {
    actionType: "notify",
    outcome: "ok",
    detail: [notes.join(", "), ...who.empty].filter(Boolean).join(" · "),
  };
}

// ── internal_note ─────────────────────────────────────────────────────

async function doInternalNote(
  action: Extract<RuleAction, { type: "internal_note" }>,
  ctx: ExecuteContext,
): Promise<ActionOutcome> {
  const body = renderMessage(action.body, renderCtx(ctx));

  // authorType 'system' is load-bearing, not cosmetic: `eventsFromDiff`
  // returns no events for a system message, which is what stops a
  // note-triggered rule that posts a note from running away.
  await db.insert(messages).values({
    ticketId: ctx.facts.ticket.id,
    authorId: null,
    authorEmail: "automation@axiom360.it",
    authorName: `Automation — ${ctx.ruleName}`.slice(0, 120),
    authorType: "system",
    body,
    bodyFormat: "text",
    channel: "system",
    isInternalNote: true,
    moderationStatus: "approved",
  });

  return {
    actionType: "internal_note",
    outcome: "ok",
    detail: body.slice(0, 200),
  };
}

// ── flag ──────────────────────────────────────────────────────────────

async function doFlag(
  action: Extract<RuleAction, { type: "flag" }>,
  ctx: ExecuteContext,
): Promise<ActionOutcome> {
  // Records that the rule matched and does nothing else: no alert, no change.
  //
  // This is the action that makes a rule safe to trial. Write it with `flag`
  // alone, leave it a day, read the activity log, and only then add the
  // notification — rather than discovering the conditions were wrong by
  // texting fourteen people at 02:00.
  await audit({
    actorId: null,
    action: "automation.rule_flagged",
    targetType: "ticket",
    targetId: ctx.facts.ticket.ticketNumber,
    after: {
      rule: ctx.ruleName,
      trigger: ctx.triggerKey,
      reason: renderMessage(action.reason, renderCtx(ctx)),
    },
  });

  return {
    actionType: "flag",
    outcome: "ok",
    detail: renderMessage(action.reason, renderCtx(ctx)).slice(0, 200),
  };
}

// ── webhook ───────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 8000;

async function doWebhook(
  action: Extract<RuleAction, { type: "webhook" }>,
  ctx: ExecuteContext,
): Promise<ActionOutcome> {
  const t = ctx.facts.ticket;
  // Deliberately a SUMMARY, not the whole ticket: this leaves our
  // infrastructure, so it carries what an integration needs to look the
  // ticket up and nothing more. No description, no customer name, no
  // conversation.
  const payload = {
    rule: { id: ctx.ruleId, name: ctx.ruleName },
    trigger: ctx.triggerKey,
    firedAt: ctx.now.toISOString(),
    ticket: {
      id: t.id,
      number: t.ticketNumber,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      category: t.category,
      organizationId: t.organizationId,
      assignedToId: t.assignedToId,
      url: ticketUrl(t.id),
    },
  };
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Axiom360-Automation/1",
  };
  if (action.secret) {
    // Lets the receiver prove the call came from us. Timestamped so a
    // captured body cannot be replayed indefinitely.
    const ts = String(Math.floor(ctx.now.getTime() / 1000));
    headers["x-axiom-timestamp"] = ts;
    headers["x-axiom-signature"] = createHmac("sha256", action.secret)
      .update(`${ts}.${body}`)
      .digest("hex");
  }

  const res = await fetch(action.url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    redirect: "error",
  });

  if (!res.ok) {
    return {
      actionType: "webhook",
      outcome: "error",
      error: `${new URL(action.url).host} answered ${res.status}`,
    };
  }
  return {
    actionType: "webhook",
    outcome: "ok",
    detail: `${new URL(action.url).host} answered ${res.status}`,
  };
}
