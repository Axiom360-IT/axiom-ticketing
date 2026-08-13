import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/can";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";

// ── Fakes ────────────────────────────────────────────────────────────
// This exercises the real previewCustomerImport/commitCustomerImport
// logic (row classification, dedup, domain resolution, phone parsing,
// skip-counting) with every DB/network dependency faked — nothing here
// ever opens a real Postgres connection or fires a real Inngest event.
// Local dev shares the production database, so a test that touched it
// for real would be writing fake customers into prod.

const mockState = vi.hoisted(() => ({
  sessionUser: null as SessionUser | null,
  existingUsers: [] as { id: string; email: string }[],
  roleRows: [] as { userId: string; roleName: string }[],
  orgRows: [] as { id: string }[],
  sentEvents: [] as unknown[],
  createOrganization: vi.fn(),
  suggestOrgCode: vi.fn(),
  resolveDomainsForImport: vi.fn(async () => new Map()),
}));

function makeUser(opts: {
  id?: string;
  permissions?: readonly Permission[];
}): SessionUser {
  return {
    id: opts.id ?? "user-actor",
    permissions: new Set(opts.permissions ?? ALL_PERMISSIONS),
    roleNames: new Set(["Super Admin"]),
    isImpersonating: false,
  };
}

vi.mock("@/lib/auth/session", () => ({
  requireSessionUser: vi.fn(async () => {
    if (!mockState.sessionUser) {
      throw new Error("test bug: no sessionUser configured");
    }
    return mockState.sessionUser;
  }),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(() => {
      let tableName: string | undefined;
      const builder = {
        from(table: unknown) {
          tableName = getTableName(table as never);
          return builder;
        },
        innerJoin() {
          return builder;
        },
        where() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          let data: unknown[] = [];
          if (tableName === "users") data = mockState.existingUsers;
          else if (tableName === "user_roles") data = mockState.roleRows;
          else if (tableName === "organizations") data = mockState.orgRows;
          return Promise.resolve(data).then(resolve, reject);
        },
      };
      return builder;
    }),
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(async (event: unknown) => {
      mockState.sentEvents.push(event);
      return { ids: ["evt-mock"] };
    }),
  },
}));

vi.mock("@/app/actions/organizations", () => ({
  createOrganization: mockState.createOrganization,
  suggestOrgCode: mockState.suggestOrgCode,
}));

vi.mock("@/lib/customer-import/domain-resolution", () => ({
  resolveDomainsForImport: mockState.resolveDomainsForImport,
}));

const { previewCustomerImport, commitCustomerImport } = await import(
  "./customer-import"
);

beforeEach(() => {
  mockState.sessionUser = makeUser({});
  mockState.existingUsers = [];
  mockState.roleRows = [];
  mockState.orgRows = [];
  mockState.sentEvents = [];
  mockState.createOrganization.mockReset();
  mockState.suggestOrgCode.mockReset().mockResolvedValue({ ok: true, code: "ACM" });
  mockState.resolveDomainsForImport.mockReset().mockResolvedValue(new Map());
});

// ── previewCustomerImport ───────────────────────────────────────────

describe("previewCustomerImport", () => {
  it("normalizes a valid row's phone number and marks it valid", async () => {
    mockState.resolveDomainsForImport.mockResolvedValue(
      new Map([
        [
          "acme.com",
          {
            domain: "acme.com",
            organizationId: "org-acme",
            organizationName: "Acme Inc",
            isFreeMail: false,
          },
        ],
      ]),
    );

    const result = await previewCustomerImport([
      { name: "Jane Doe", email: "jane@acme.com", phone: "415-555-2671" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      status: "valid",
      phone: "+14155552671",
      phoneWarning: undefined,
      organizationId: "org-acme",
    });
    expect(result.validCount).toBe(1);
  });

  it("keeps an unparseable phone row valid, but drops the phone with a warning", async () => {
    const result = await previewCustomerImport([
      { name: "Bad Phone", email: "bad@gmail.com", phone: "not a phone" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      status: "valid",
      phone: "",
    });
    expect(result.rows[0].phoneWarning).toMatch(/couldn't be recognized/i);
  });

  it("flags a second row with the same email as duplicate_in_file", async () => {
    const result = await previewCustomerImport([
      { name: "Jane Doe", email: "dupe@gmail.com" },
      { name: "Jane Doe Two", email: "dupe@gmail.com" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
    expect(result.rows[1].status).toBe("duplicate_in_file");
    expect(result.validCount).toBe(1);
  });

  it("flags an already-invited customer as duplicate_existing_customer", async () => {
    mockState.existingUsers = [{ id: "u-1", email: "existing@gmail.com" }];
    mockState.roleRows = [{ userId: "u-1", roleName: "Customer" }];

    const result = await previewCustomerImport([
      { name: "Existing Customer", email: "existing@gmail.com" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("duplicate_existing_customer");
  });

  it("flags an existing staff account as duplicate_existing_staff, not a plain customer dup", async () => {
    mockState.existingUsers = [{ id: "u-2", email: "tech@axiom360.it" }];
    mockState.roleRows = [{ userId: "u-2", roleName: "Technician" }];

    const result = await previewCustomerImport([
      { name: "Some Tech", email: "tech@axiom360.it" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("duplicate_existing_staff");
  });

  it("marks a malformed email row invalid instead of throwing", async () => {
    const result = await previewCustomerImport([
      { name: "No Email", email: "not-an-email" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("invalid");
    expect(result.validCount).toBe(0);
  });

  it("groups a valid, non-free-mail, unmatched domain for org resolution", async () => {
    const result = await previewCustomerImport([
      { name: "New Co", email: "person@newco.com" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unmatchedDomains).toHaveLength(1);
    expect(result.unmatchedDomains[0]).toMatchObject({
      domain: "newco.com",
      suggestedAbbreviation: "ACM", // from the mocked suggestOrgCode
    });
  });

  it("rejects when the caller lacks users.create", async () => {
    mockState.sessionUser = makeUser({ permissions: [] });
    await expect(
      previewCustomerImport([{ name: "X", email: "x@gmail.com" }]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ── commitCustomerImport ─────────────────────────────────────────────

describe("commitCustomerImport", () => {
  it("queues only valid, org-resolved rows via a single Inngest event", async () => {
    mockState.resolveDomainsForImport.mockResolvedValue(
      new Map([
        [
          "acme.com",
          {
            domain: "acme.com",
            organizationId: "org-acme",
            organizationName: "Acme Inc",
            isFreeMail: false,
          },
        ],
      ]),
    );

    const result = await commitCustomerImport(
      [
        { name: "Good Row", email: "good@acme.com" },
        { name: "Bad Row", email: "not-an-email" },
      ],
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queuedCount).toBe(1);
    expect(result.skippedInvalid).toBe(1);
    expect(mockState.sentEvents).toHaveLength(1);
    expect(mockState.sentEvents[0]).toMatchObject({
      name: "customer-import/batch.requested",
      data: {
        rows: [{ email: "good@acme.com", organizationId: "org-acme" }],
      },
    });
  });

  it("skips a row whose domain decision is 'skip'", async () => {
    const result = await commitCustomerImport(
      [{ name: "Needs Org", email: "person@newco.com" }],
      { "newco.com": { type: "skip" } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queuedCount).toBe(0);
    expect(result.skippedNeedsOrg).toBe(1);
    expect(mockState.sentEvents).toHaveLength(0);
  });

  it("assigns a resolved domain decision to an existing organization", async () => {
    const existingOrgId = "11111111-1111-4111-8111-111111111111";
    mockState.orgRows = [{ id: existingOrgId }];

    const result = await commitCustomerImport(
      [{ name: "Needs Org", email: "person@newco.com" }],
      { "newco.com": { type: "assign", organizationId: existingOrgId } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queuedCount).toBe(1);
    expect(mockState.sentEvents[0]).toMatchObject({
      data: { rows: [{ organizationId: existingOrgId }] },
    });
    expect(mockState.createOrganization).not.toHaveBeenCalled();
  });

  it("creates a new organization for a 'create' domain decision and links the row to it", async () => {
    mockState.createOrganization.mockResolvedValue({
      ok: true,
      organizationId: "org-new",
    });

    const result = await commitCustomerImport(
      [{ name: "Needs Org", email: "person@newco.com" }],
      {
        "newco.com": {
          type: "create",
          name: "New Co",
          abbreviation: "NEW",
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockState.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Co", abbreviation: "NEW" }),
    );
    expect(result.queuedCount).toBe(1);
    expect(mockState.sentEvents[0]).toMatchObject({
      data: { rows: [{ organizationId: "org-new" }] },
    });
  });

  it("does not queue anything (and sends no Inngest event) when every row is skipped", async () => {
    const result = await commitCustomerImport(
      [{ name: "Dup", email: "not-an-email" }],
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queuedCount).toBe(0);
    expect(mockState.sentEvents).toHaveLength(0);
  });

  it("rejects when the caller lacks users.create", async () => {
    mockState.sessionUser = makeUser({ permissions: [] });
    await expect(
      commitCustomerImport([{ name: "X", email: "x@gmail.com" }], {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
