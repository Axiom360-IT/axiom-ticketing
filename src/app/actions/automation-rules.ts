"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { isReauthFresh, reauthRequiredResult } from "@/lib/auth/reauth";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { automationRules } from "@/lib/db/schema/automation-rules";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { describeRule } from "@/lib/rules/describe";
import { previewRule, type RulePreview } from "@/lib/rules/preview";
import {
  hasMutatingAction,
  type RuleInput,
  ruleInputSchema,
} from "@/lib/rules/schema";
import { recentActivityFor } from "@/lib/rules/store";
import type { RuleTrigger } from "@/lib/rules/types";

// ── Automation rules: CRUD ────────────────────────────────────────────
//
// Gated on `settings.update`, exactly as scheduled reports are, and for the
// same reason: a rule decides who gets emailed and what happens to tickets,
// which is the same blast radius as the settings it sits beside. Deliberately
// NOT a new permission — a new one needs an explicit case in `can()` to dodge
// the switch's `default: return true`, plus a migration script, because
// `pnpm db:seed` no-ops on a live database.
//
// Re-auth is required to CREATE, CHANGE or DELETE a rule (adding a recipient
// is how company data leaves the building) but NOT to pause one. Pausing is
// reversible and only ever does less.

export type RuleResult =
  | { ok: true; id: string }
  | { ok: false; error: string; reauthRequired?: true };

async function requireOperator() {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return caller;
}

/** The two denormalized columns the dispatchers index on. */
function triggerColumns(trigger: RuleTrigger): {
  triggerKind: string;
  triggerKey: string;
} {
  switch (trigger.kind) {
    case "event":
      return { triggerKind: "event", triggerKey: trigger.event };
    case "state":
      return { triggerKind: "state", triggerKey: trigger.state };
    case "schedule":
      // A schedule rule is its own trigger — there is no shared key to group
      // by, so the dispatcher loads them all and checks the clock.
      return { triggerKind: "schedule", triggerKey: "schedule" };
  }
}

/**
 * Phase-1 gate, enforced at the door as well as at the executor.
 *
 * Refusing here gives the operator a sentence they can act on while they are
 * still looking at the form. The executor refuses again at run time, because
 * a rule row can outlive the rule that created it.
 */
function refuseMutating(input: RuleInput): string | null {
  const actions = (input.actions ?? []) as Parameters<typeof hasMutatingAction>[0];
  return hasMutatingAction(actions)
    ? "This rule would change a ticket, and the engine is not allowed to do that yet. For now a rule can tell people, post a note, record it, or call a webhook."
    : null;
}

export async function createRule(input: RuleInput): Promise<RuleResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) {
    return reauthRequiredResult() as RuleResult;
  }

  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const blocked = refuseMutating(parsed.data as RuleInput);
  if (blocked) return { ok: false, error: blocked };

  const cols = triggerColumns(parsed.data.trigger as RuleTrigger);
  const [row] = await db
    .insert(automationRules)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ...cols,
      trigger: parsed.data.trigger,
      conditions: parsed.data.conditions,
      actions: parsed.data.actions,
      dedupe: parsed.data.dedupe,
      stopOnMatch: parsed.data.stopOnMatch,
      allowChaining: parsed.data.allowChaining,
      applyToExisting: parsed.data.applyToExisting,
      order: parsed.data.order,
      createdById: caller.id,
      // A rule arrives switched OFF. Nobody should be able to write a rule
      // and have it act before they have read the sentence back.
      enabled: false,
    })
    .returning({ id: automationRules.id });

  if (!row) return { ok: false, error: "Could not save the rule." };

  await audit({
    actorId: caller.id,
    action: "automation.rule_create",
    targetType: "automation_rule",
    targetId: row.id,
    after: {
      name: parsed.data.name,
      // The sentence, not the jsonb — an audit entry nobody can read is an
      // audit entry nobody reads.
      rule: describeRule({
        trigger: parsed.data.trigger as RuleTrigger,
        conditions: parsed.data.conditions,
        actions: parsed.data.actions,
      }),
    },
  });

  revalidatePath("/admin/automations");
  return { ok: true, id: row.id };
}

export async function updateRule(
  id: string,
  input: RuleInput,
): Promise<RuleResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) {
    return reauthRequiredResult() as RuleResult;
  }
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const blocked = refuseMutating(parsed.data as RuleInput);
  if (blocked) return { ok: false, error: blocked };

  const [before] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.id, id))
    .limit(1);
  if (!before) throw new NotFoundError();

  const cols = triggerColumns(parsed.data.trigger as RuleTrigger);
  await db
    .update(automationRules)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ...cols,
      trigger: parsed.data.trigger,
      conditions: parsed.data.conditions,
      actions: parsed.data.actions,
      dedupe: parsed.data.dedupe,
      stopOnMatch: parsed.data.stopOnMatch,
      allowChaining: parsed.data.allowChaining,
      applyToExisting: parsed.data.applyToExisting,
      order: parsed.data.order,
      // Editing a rule is how you fix a broken one, so clear the flag and let
      // the engine re-decide. Also resets the budget: a rule paused for
      // overspending is released by the fix, not by waiting an hour.
      brokenReason: null,
      budgetSpent: 0,
      budgetWindowStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, id));

  await audit({
    actorId: caller.id,
    action: "automation.rule_update",
    targetType: "automation_rule",
    targetId: id,
    before: { name: before.name },
    after: {
      name: parsed.data.name,
      rule: describeRule({
        trigger: parsed.data.trigger as RuleTrigger,
        conditions: parsed.data.conditions,
        actions: parsed.data.actions,
      }),
    },
  });

  revalidatePath("/admin/automations");
  return { ok: true, id };
}

/** Pause or resume. No re-auth: reversible, and pausing only ever does less. */
export async function setRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<RuleResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const updated = await db
    .update(automationRules)
    .set({
      enabled,
      // Switching a rule back on is the operator saying they have dealt with
      // whatever broke it; leaving the flag would make it un-startable.
      ...(enabled
        ? { brokenReason: null, budgetSpent: 0, budgetWindowStartedAt: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, id))
    .returning({ id: automationRules.id, name: automationRules.name });
  if (updated.length === 0) throw new NotFoundError();

  await audit({
    actorId: caller.id,
    action: enabled ? "automation.rule_enable" : "automation.rule_disable",
    targetType: "automation_rule",
    targetId: id,
    after: { name: updated[0]?.name, enabled },
  });

  revalidatePath("/admin/automations");
  return { ok: true, id };
}

export async function deleteRule(id: string): Promise<RuleResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) {
    return reauthRequiredResult() as RuleResult;
  }
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  // The fire ledger and both logs cascade. That is correct: deleting a rule
  // means it never existed, and a kept ledger would suppress a rule recreated
  // under a new id for tickets it has never actually fired for.
  const deleted = await db
    .delete(automationRules)
    .where(eq(automationRules.id, id))
    .returning();
  if (deleted.length === 0) throw new NotFoundError();

  await audit({
    actorId: caller.id,
    action: "automation.rule_delete",
    targetType: "automation_rule",
    targetId: id,
    before: { name: deleted[0]?.name },
  });

  revalidatePath("/admin/automations");
  return { ok: true, id };
}

/** Copy a rule, switched off, so a variant can be built without risking the
 *  original. The commonest safe way to change a rule that is already working. */
export async function duplicateRule(id: string): Promise<RuleResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }

  const [source] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.id, id))
    .limit(1);
  if (!source) throw new NotFoundError();

  const [row] = await db
    .insert(automationRules)
    .values({
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      triggerKind: source.triggerKind,
      triggerKey: source.triggerKey,
      trigger: source.trigger,
      conditions: source.conditions,
      actions: source.actions,
      dedupe: source.dedupe,
      stopOnMatch: source.stopOnMatch,
      allowChaining: source.allowChaining,
      applyToExisting: source.applyToExisting,
      order: source.order,
      createdById: caller.id,
      enabled: false,
    })
    .returning({ id: automationRules.id });

  if (!row) return { ok: false, error: "Could not copy the rule." };

  await audit({
    actorId: caller.id,
    action: "automation.rule_create",
    targetType: "automation_rule",
    targetId: row.id,
    after: { name: `${source.name} (copy)`, copiedFrom: id },
  });

  revalidatePath("/admin/automations");
  return { ok: true, id: row.id };
}

// ── Preview ───────────────────────────────────────────────────────────

export type PreviewResult =
  | { ok: true; preview: RulePreview }
  | { ok: false; error: string };

/**
 * What would this rule match right now?
 *
 * No re-auth and no mutation gate: it is read-only, and an operator tuning a
 * condition will run it a dozen times. Still rate-limited, because it reads
 * every open ticket.
 */
export async function previewRuleNow(
  input: Pick<RuleInput, "trigger" | "conditions" | "applyToExisting">,
  createdAt?: string,
): Promise<PreviewResult> {
  const caller = await requireOperator();
  await enforceUserRateLimit("authPreviewRule", caller.id);

  const shape = ruleInputSchema.safeParse({
    name: "preview",
    trigger: input.trigger,
    conditions: input.conditions,
    // The preview only cares about trigger and conditions; a placeholder
    // action keeps it on the same validation path as a real save, so a rule
    // that previews cleanly cannot fail validation on save.
    actions: [{ type: "flag", reason: "preview" }],
    dedupe: { policy: "once_per_ticket" },
    applyToExisting: input.applyToExisting ?? false,
  });
  if (!shape.success) {
    return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid rule" };
  }

  try {
    const preview = await previewRule({
      trigger: shape.data.trigger as RuleTrigger,
      conditions: shape.data.conditions,
      applyToExisting: shape.data.applyToExisting,
      createdAt: createdAt ? new Date(createdAt) : null,
    });
    return { ok: true, preview };
  } catch (err) {
    console.error("[rules] preview failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not work that out.",
    };
  }
}

// ── Activity ──────────────────────────────────────────────────────────

export type RuleActivity = Awaited<ReturnType<typeof recentActivityFor>>;

/** What a rule has done, and why it did not do more. The answer to "why
 *  didn't my rule fire?" — read-only, so no re-auth. */
export async function ruleActivity(id: string): Promise<
  { ok: true; activity: RuleActivity } | { ok: false; error: string }
> {
  await requireOperator();
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid input" };
  }
  return { ok: true, activity: await recentActivityFor(id) };
}
