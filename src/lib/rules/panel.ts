import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/rbac";
import { ticketCategories } from "@/lib/db/schema/ticket-categories";
import { ticketTypes } from "@/lib/db/schema/ticket-types";
import { changeFeedBacklog } from "./changefeed";
import { type ClientCatalog, clientCatalog } from "./catalog";
import { describeRule, type RefNames } from "./describe";
import { parseStoredRule } from "./schema";
import { activityCounts, listRuleRows, type RuleRow } from "./store";
import type { RuleTrigger } from "./types";

// ── Everything the rules section renders, in one load ─────────────────
//
// The sentence is computed HERE rather than in the browser so the card is
// correct on first paint, and so a rule whose jsonb no longer parses shows as
// broken rather than as a blank card or a crashed section.

export type RuleCard = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  order: number;
  triggerKind: string;
  /** The rule as one English sentence. Null when the row no longer parses. */
  sentence: string | null;
  /** Why it will not run — a parse failure, or the engine pausing it. */
  brokenReason: string | null;
  lastFiredAt: string | null;
  firedLast24h: number;
  errorsLast24h: number;
  /** Raw jsonb, for the editor to load into its form. */
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  dedupe: unknown;
  stopOnMatch: boolean;
  allowChaining: boolean;
  applyToExisting: boolean;
  createdAt: string;
};

/** Everything the builder needs to turn an id into a name, and back. */
export type RuleRefs = {
  users: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  categories: { value: string; label: string }[];
  ticketTypes: { value: string; label: string }[];
};

export type RulesPanel = {
  rules: RuleCard[];
  refs: RuleRefs;
  catalog: ClientCatalog;
  /** How far behind the change feed is, so a stalled dispatcher is visible
   *  without reading logs. */
  backlog: { pending: number; oldestMinutes: number | null };
};

function refNames(refs: RuleRefs): RefNames {
  return {
    users: Object.fromEntries(refs.users.map((u) => [u.id, u.name])),
    roles: Object.fromEntries(refs.roles.map((r) => [r.name, r.name])),
    organizations: Object.fromEntries(
      refs.organizations.map((o) => [o.id, o.name]),
    ),
  };
}

function toCard(
  row: RuleRow,
  names: RefNames,
  activity: Map<string, { ok: number; errors: number }>,
): RuleCard {
  const parsed = parseStoredRule(row);
  const counts = activity.get(row.id) ?? { ok: 0, errors: 0 };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    order: row.order,
    triggerKind: row.triggerKind,
    sentence: parsed.ok
      ? describeRule(
          {
            trigger: parsed.parts.trigger,
            conditions: parsed.parts.conditions,
            actions: parsed.parts.actions,
          },
          names,
        )
      : null,
    // A parse failure wins over a stored reason: it is the more immediate
    // problem, and the stored one may be stale.
    brokenReason: parsed.ok ? row.brokenReason : parsed.reason,
    lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    firedLast24h: counts.ok,
    errorsLast24h: counts.errors,
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
    dedupe: row.dedupe,
    stopOnMatch: row.stopOnMatch,
    allowChaining: row.allowChaining,
    applyToExisting: row.applyToExisting,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadRulesPanel(): Promise<RulesPanel> {
  const [rows, activity, userRows, roleRows, orgRows, catRows, typeRows, backlog] =
    await Promise.all([
      listRuleRows(),
      activityCounts(24),
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(asc(users.name)),
      db
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .orderBy(asc(roles.name)),
      db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .orderBy(asc(organizations.name)),
      db
        .select({ value: ticketCategories.value, label: ticketCategories.label })
        .from(ticketCategories)
        .where(eq(ticketCategories.isActive, true))
        .orderBy(asc(ticketCategories.sortOrder)),
      db
        .select({ value: ticketTypes.value, label: ticketTypes.label })
        .from(ticketTypes)
        .where(eq(ticketTypes.isActive, true))
        .orderBy(asc(ticketTypes.sortOrder)),
      changeFeedBacklog(),
    ]);

  const refs: RuleRefs = {
    users: userRows,
    roles: roleRows,
    organizations: orgRows,
    categories: catRows,
    ticketTypes: typeRows,
  };
  const names = refNames(refs);

  return {
    rules: rows.map((r) => toCard(r, names, activity)),
    refs,
    catalog: clientCatalog(),
    backlog: {
      pending: backlog.pending,
      oldestMinutes: backlog.oldest
        ? Math.floor((Date.now() - backlog.oldest.getTime()) / 60_000)
        : null,
    },
  };
}

/** A rule's trigger kind without parsing the whole thing — for the icon. */
export function triggerKindOf(trigger: unknown): RuleTrigger["kind"] | null {
  if (trigger && typeof trigger === "object" && "kind" in trigger) {
    const kind = (trigger as { kind: unknown }).kind;
    if (kind === "event" || kind === "state" || kind === "schedule") return kind;
  }
  return null;
}
