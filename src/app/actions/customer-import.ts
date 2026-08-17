"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { emailDomain } from "@/lib/email/email-domain";
import {
  resolveDomainsForImport,
  type DomainResolution,
} from "@/lib/customer-import/domain-resolution";
import {
  guessOrgNameFromDomain,
  isFreeMailDomain,
} from "@/lib/customer-import/domain-guess";
import { normalizeImportPhone } from "@/lib/customer-import/phone-normalize";
import { createOrganization, suggestOrgCode } from "@/app/actions/organizations";
import {
  createCustomerImportStubs,
  loadCustomerRoleId,
} from "@/lib/users/provision";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { inngest } from "@/inngest/client";

const MAX_ROWS = 500;
const DEFAULT_PHONE_COUNTRY = "US";

// Phone format is intentionally NOT validated here — a raw pasted value
// (any format, with or without a country code) is normalized separately via
// normalizeImportPhone(), using the caller-selected default country to
// resolve an ambiguous local-format number. An unparseable phone drops
// silently (phone stays optional) rather than invalidating the row.
const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(40).optional().default(""),
});

export type CustomerImportRowInput = { name: string; email: string; phone?: string };

export type PreviewRowStatus =
  | "valid"
  | "duplicate_in_file"
  | "duplicate_existing_customer"
  | "duplicate_existing_staff"
  | "invalid";

export type PreviewRow = {
  index: number;
  name: string;
  email: string;
  phone: string;
  /** Set when a non-empty pasted phone couldn't be parsed against the
   *  selected default country — the row still imports, just without a
   *  phone number. */
  phoneWarning?: string;
  status: PreviewRowStatus;
  error?: string;
  domain: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

export type DomainGroup = {
  domain: string;
  rowIndexes: number[];
  isFreeMail: boolean;
  suggestedName: string;
  suggestedAbbreviation: string | null;
};

export type PreviewResult =
  | {
      ok: true;
      rows: PreviewRow[];
      unmatchedDomains: DomainGroup[];
      canCreateOrg: boolean;
      validCount: number;
    }
  | { ok: false; error: string };

/**
 * Parses + validates a bulk-import row set and resolves each row's
 * organization by email domain. Read-only — nothing is written. The UI
 * shows this preview, resolves any unmatched-domain groups (create/assign/
 * skip), then calls commitCustomerImport with the same rows.
 */
export async function previewCustomerImport(
  input: CustomerImportRowInput[],
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): Promise<PreviewResult> {
  const caller = await requireSessionUser();
  if (!(await can(caller, "users.create", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  if (input.length === 0) {
    return { ok: false, error: "No rows to import." };
  }
  if (input.length > MAX_ROWS) {
    return { ok: false, error: `A single import is capped at ${MAX_ROWS} rows.` };
  }

  const canCreateOrg = await can(
    caller,
    "organizations.create",
    { type: "global" },
    productionContext,
  );

  const seenInFile = new Set<string>();
  const parsedRows: (Omit<PreviewRow, "domain" | "organizationId" | "organizationName"> & {
    rawEmail: string;
  })[] = [];

  input.forEach((raw, index) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      parsedRows.push({
        index,
        name: raw.name ?? "",
        email: raw.email ?? "",
        phone: raw.phone ?? "",
        status: "invalid",
        error: parsed.error.issues[0]?.message ?? "Invalid row",
        rawEmail: (raw.email ?? "").trim().toLowerCase(),
      });
      return;
    }
    const email = parsed.data.email;
    if (seenInFile.has(email)) {
      parsedRows.push({
        index,
        name: parsed.data.name,
        email,
        phone: parsed.data.phone,
        status: "duplicate_in_file",
        error: "This email appears more than once in the uploaded list.",
        rawEmail: email,
      });
      return;
    }
    seenInFile.add(email);
    let phone = "";
    let phoneWarning: string | undefined;
    if (parsed.data.phone) {
      const normalized = normalizeImportPhone(parsed.data.phone, defaultCountry);
      if (normalized.ok) {
        phone = normalized.e164;
      } else {
        phoneWarning = "Phone number couldn't be recognized — imported without it.";
      }
    }
    parsedRows.push({
      index,
      name: parsed.data.name,
      email,
      phone,
      phoneWarning,
      status: "valid",
      rawEmail: email,
    });
  });

  // Check every VALID row's email against existing accounts in one query.
  const candidateEmails = parsedRows
    .filter((r) => r.status === "valid")
    .map((r) => r.rawEmail);
  const existingByEmail = new Map<
    string,
    { id: string; roleNames: string[] }
  >();
  if (candidateEmails.length > 0) {
    const existingUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, candidateEmails));
    if (existingUsers.length > 0) {
      const roleRows = await db
        .select({ userId: userRoles.userId, roleName: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          inArray(
            userRoles.userId,
            existingUsers.map((u) => u.id),
          ),
        );
      const rolesByUserId = new Map<string, string[]>();
      for (const r of roleRows) {
        const list = rolesByUserId.get(r.userId) ?? [];
        list.push(r.roleName);
        rolesByUserId.set(r.userId, list);
      }
      for (const u of existingUsers) {
        existingByEmail.set(u.email, {
          id: u.id,
          roleNames: rolesByUserId.get(u.id) ?? [],
        });
      }
    }
  }

  // Batch-resolve every distinct domain across the VALID rows in one query.
  const domainByEmail = await resolveDomainsForImport(
    parsedRows.filter((r) => r.status === "valid").map((r) => r.email),
  );

  const rows: PreviewRow[] = parsedRows.map((r) => {
    const domain = emailDomain(r.email);
    const existing = existingByEmail.get(r.rawEmail);
    let status = r.status;
    let error = r.error;
    if (status === "valid" && existing) {
      const INTERNAL_ROLE_NAMES = new Set([
        "Super Admin",
        "IT Director",
        "Coordinator",
        "Technician",
      ]);
      const isStaff = existing.roleNames.some((n) => INTERNAL_ROLE_NAMES.has(n));
      status = isStaff ? "duplicate_existing_staff" : "duplicate_existing_customer";
      error = isStaff
        ? "This email already belongs to a staff account."
        : "This email already has a customer account.";
    }
    const resolution: DomainResolution | undefined = domain
      ? domainByEmail.get(domain)
      : undefined;
    return {
      index: r.index,
      name: r.name,
      email: r.email,
      phone: r.phone,
      phoneWarning: r.phoneWarning,
      status,
      error,
      domain: domain ?? null,
      organizationId: resolution?.organizationId ?? null,
      organizationName: resolution?.organizationName ?? null,
    };
  });

  // Unmatched domains: valid rows, real domain, no org match, not free-mail.
  const unmatchedByDomain = new Map<string, number[]>();
  for (const row of rows) {
    if (row.status !== "valid" || !row.domain || row.organizationId) continue;
    if (isFreeMailDomain(row.domain)) continue;
    const list = unmatchedByDomain.get(row.domain) ?? [];
    list.push(row.index);
    unmatchedByDomain.set(row.domain, list);
  }

  // One suggestOrgCode round-trip per distinct unmatched domain — run them
  // concurrently rather than one-at-a-time (each is an independent DB read,
  // no shared state between iterations) so a file spanning many
  // previously-unseen companies doesn't pay for each lookup in sequence.
  const unmatchedDomains: DomainGroup[] = await Promise.all(
    [...unmatchedByDomain].map(async ([domain, rowIndexes]) => {
      const suggestedName = guessOrgNameFromDomain(domain);
      let suggestedAbbreviation: string | null = null;
      if (canCreateOrg) {
        const suggestion = await suggestOrgCode(suggestedName);
        suggestedAbbreviation = suggestion.ok ? suggestion.code : null;
      }
      return {
        domain,
        rowIndexes,
        isFreeMail: false,
        suggestedName,
        suggestedAbbreviation,
      };
    }),
  );

  return {
    ok: true,
    rows,
    unmatchedDomains,
    canCreateOrg,
    validCount: rows.filter((r) => r.status === "valid").length,
  };
}

// ── Commit ───────────────────────────────────────────────────────────

const domainDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    name: z.string().trim().min(1).max(160),
    abbreviation: z.string().trim().min(1).max(20),
  }),
  z.object({ type: z.literal("assign"), organizationId: z.string().uuid() }),
  z.object({ type: z.literal("skip") }),
]);

export type DomainDecision = z.infer<typeof domainDecisionSchema>;

export type CommitCustomerImportResult =
  | {
      ok: true;
      batchId: string;
      queuedCount: number;
      skippedDuplicate: number;
      skippedInvalid: number;
      skippedNeedsOrg: number;
      /** Lost a genuine concurrent-duplicate race on `users.email` between
       *  re-validation and the stub insert — distinct from skippedDuplicate,
       *  which is known deterministically at re-validation time. */
      skippedRaceDuplicate: number;
    }
  | { ok: false; error: string };

/**
 * Re-validates everything from scratch (never trusts the client-echoed
 * preview — state may have changed since it was rendered), resolves any
 * unmatched-domain decisions (creating new organizations synchronously,
 * since that's one call per distinct company, not per person), then
 * dispatches ONE Inngest event with the fully-resolved row list. The actual
 * user-provisioning happens in the customer-import-batch Inngest function
 * so a large file can't blow past the request/statement timeout.
 */
export async function commitCustomerImport(
  input: CustomerImportRowInput[],
  domainDecisions: Record<string, DomainDecision>,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): Promise<CommitCustomerImportResult> {
  const caller = await requireSessionUser();
  if (!(await can(caller, "users.create", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  await enforceUserRateLimit("bulkImportUsers", caller.id);

  const parsedDecisions = z
    .record(z.string(), domainDecisionSchema)
    .safeParse(domainDecisions);
  if (!parsedDecisions.success) {
    return { ok: false, error: "Invalid organization decision." };
  }

  const preview = await previewCustomerImport(input, defaultCountry);
  if (!preview.ok) return preview;

  // Resolve each unmatched domain's decision. "create" makes the org NOW
  // (one call per distinct company) and links the triggering domain to it
  // in the same call, so the next import against this domain matches
  // immediately.
  const resolvedOrgByDomain = new Map<string, string | null>();
  for (const group of preview.unmatchedDomains) {
    const decision = parsedDecisions.data[group.domain];
    if (!decision || decision.type === "skip") {
      resolvedOrgByDomain.set(group.domain, null);
      continue;
    }
    if (decision.type === "assign") {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, decision.organizationId))
        .limit(1);
      if (!org) {
        return { ok: false, error: `Organization not found for ${group.domain}.` };
      }
      resolvedOrgByDomain.set(group.domain, decision.organizationId);
      continue;
    }
    if (!preview.canCreateOrg) {
      return {
        ok: false,
        error: "You don't have permission to create organizations.",
      };
    }
    const created = await createOrganization({
      name: decision.name,
      abbreviation: decision.abbreviation,
      isMonthlyPlan: false,
      isActive: true,
      emailDomains: [group.domain],
    });
    if (!created.ok) return { ok: false, error: created.error };
    resolvedOrgByDomain.set(group.domain, created.organizationId);
  }

  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  let skippedNeedsOrg = 0;
  const finalRows: {
    name: string;
    email: string;
    phone: string;
    organizationId: string;
  }[] = [];

  for (const row of preview.rows) {
    if (row.status === "invalid") {
      skippedInvalid++;
      continue;
    }
    if (
      row.status === "duplicate_in_file" ||
      row.status === "duplicate_existing_customer" ||
      row.status === "duplicate_existing_staff"
    ) {
      skippedDuplicate++;
      continue;
    }
    // status === "valid" from here.
    let organizationId = row.organizationId;
    if (!organizationId && row.domain) {
      const resolved = resolvedOrgByDomain.get(row.domain);
      organizationId = resolved ?? null;
    }
    if (!organizationId) {
      skippedNeedsOrg++;
      continue;
    }
    finalRows.push({
      name: row.name,
      email: row.email,
      phone: row.phone,
      organizationId,
    });
  }

  const batchId = randomUUID();
  let queuedCount = 0;
  let skippedRaceDuplicate = 0;

  if (finalRows.length > 0) {
    // Resolved synchronously, before any row is created, so a missing
    // Customer role aborts the whole commit up front rather than leaving
    // stub rows stuck later with no way to finish provisioning them.
    const customerRoleId = await loadCustomerRoleId();
    if (!customerRoleId) {
      return {
        ok: false,
        error: "Customer role is missing — run pnpm db:seed before importing.",
      };
    }

    // Creates every row NOW, synchronously, so it's visible on the admin
    // Users list (as "provisioning") the instant this commit returns —
    // the async job below only finishes what's already there. A row
    // missing from the result lost a genuine concurrent-duplicate race on
    // users.email (rare — the window is preview's re-validation up to this
    // insert) and is counted separately, not silently dropped.
    const created = await createCustomerImportStubs(finalRows, caller.id);
    const createdByEmail = new Map(created.map((c) => [c.email, c.userId]));

    const eventRows: {
      userId: string;
      name: string;
      email: string;
      phone: string;
      organizationId: string;
    }[] = [];
    for (const row of finalRows) {
      const userId = createdByEmail.get(row.email);
      if (!userId) {
        skippedRaceDuplicate++;
        continue;
      }
      eventRows.push({ ...row, userId });
    }
    queuedCount = eventRows.length;

    await Promise.all(
      eventRows.map((row) =>
        audit({
          actorId: caller.id,
          action: "user.create",
          targetType: "user",
          targetId: row.userId,
          after: { email: row.email, organizationId: row.organizationId, batchId },
        }),
      ),
    );

    if (eventRows.length > 0) {
      await inngest.send({
        name: "customer-import/batch.requested",
        data: {
          batchId,
          importedById: caller.id,
          customerRoleId,
          rows: eventRows,
        },
      });
    }
  }

  return {
    ok: true,
    batchId,
    queuedCount,
    skippedDuplicate,
    skippedInvalid,
    skippedNeedsOrg,
    skippedRaceDuplicate,
  };
}
