import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises provisionUser/createCustomerImportStubs/finishCustomerProvisioning
// with `db`/`transactional`/`claimTicketsForCustomer` all faked — nothing
// here opens a real Postgres connection. Local dev shares the production
// database, so a test that touched it for real would be writing fake users
// into prod.

const mockState = vi.hoisted(() => ({
  existingUserRows: [] as { id: string }[],
  customerRoleRows: [] as { id: string }[],
  insertedUsersReturn: [] as { userId: string; email: string }[],
  insertValuesCalls: [] as { table: string; values: unknown }[],
  txInsertCalls: [] as { table: string; values: unknown }[],
  txUpdateCalls: [] as { table: string; values: unknown }[],
  txShouldThrow: false,
  claimTicketsForCustomer: vi.fn(async () => {}),
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
        where() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          let data: unknown[] = [];
          if (tableName === "users") data = mockState.existingUserRows;
          else if (tableName === "roles") data = mockState.customerRoleRows;
          return Promise.resolve(data).then(resolve, reject);
        },
      };
      return builder;
    }),
    insert: vi.fn((table: unknown) => {
      const tableName = getTableName(table as never);
      const builder = {
        values(v: unknown) {
          mockState.insertValuesCalls.push({ table: tableName, values: v });
          return builder;
        },
        onConflictDoNothing() {
          return builder;
        },
        returning() {
          return Promise.resolve(mockState.insertedUsersReturn);
        },
      };
      return builder;
    }),
  },
  transactional: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    if (mockState.txShouldThrow) throw new Error("transaction failed");
    const tx = {
      insert: (table: unknown) => {
        const tableName = getTableName(table as never);
        return {
          values: (v: unknown) => {
            mockState.txInsertCalls.push({ table: tableName, values: v });
            return Promise.resolve();
          },
        };
      },
      update: (table: unknown) => {
        const tableName = getTableName(table as never);
        return {
          set: (v: unknown) => ({
            where: () => {
              mockState.txUpdateCalls.push({ table: tableName, values: v });
              return Promise.resolve();
            },
          }),
        };
      },
    };
    return fn(tx);
  }),
}));

vi.mock("@/lib/customer/reconcile", () => ({
  claimTicketsForCustomer: mockState.claimTicketsForCustomer,
}));

const {
  provisionUser,
  createCustomerImportStubs,
  finishCustomerProvisioning,
  loadCustomerRoleId,
} = await import("./provision");

beforeEach(() => {
  mockState.existingUserRows = [];
  mockState.customerRoleRows = [{ id: "role-customer-1" }];
  mockState.insertedUsersReturn = [];
  mockState.insertValuesCalls = [];
  mockState.txInsertCalls = [];
  mockState.txUpdateCalls = [];
  mockState.txShouldThrow = false;
  mockState.claimTicketsForCustomer.mockClear();
});

describe("provisionUser", () => {
  it("marks a synchronously-created user as immediately fully provisioned", async () => {
    const result = await provisionUser({
      name: "Jane Doe",
      email: "jane@acme.com",
      roleIds: ["role-customer-1"],
      createdById: "admin-1",
      invitedAt: new Date(),
      inviteExpiresAt: new Date(),
    });

    expect(result.ok).toBe(true);
    const usersInsert = mockState.txInsertCalls.find((c) => c.table === "users");
    expect(usersInsert?.values).toMatchObject({
      email: "jane@acme.com",
      provisionedAt: expect.any(Date),
    });
  });
});

describe("loadCustomerRoleId", () => {
  it("returns the Customer role's id", async () => {
    await expect(loadCustomerRoleId()).resolves.toBe("role-customer-1");
  });

  it("returns null when the Customer role doesn't exist", async () => {
    mockState.customerRoleRows = [];
    await expect(loadCustomerRoleId()).resolves.toBeNull();
  });
});

describe("createCustomerImportStubs", () => {
  it("returns [] without any DB call for an empty row list", async () => {
    const result = await createCustomerImportStubs([], "admin-1");
    expect(result).toEqual([]);
  });

  it("bulk-inserts rows with no invite/provisioning fields set", async () => {
    mockState.insertedUsersReturn = [
      { userId: "u-1", email: "a@acme.com" },
      { userId: "u-2", email: "b@acme.com" },
    ];

    const result = await createCustomerImportStubs(
      [
        { name: "A", email: "a@acme.com", phone: "+15550001111", organizationId: "org-1" },
        { name: "B", email: "b@acme.com", phone: "", organizationId: "org-1" },
      ],
      "admin-1",
    );

    expect(result).toEqual([
      { userId: "u-1", email: "a@acme.com" },
      { userId: "u-2", email: "b@acme.com" },
    ]);

    const call = mockState.insertValuesCalls.find((c) => c.table === "users");
    const values = call?.values as Record<string, unknown>[];
    expect(values).toHaveLength(2);
    for (const v of values) {
      expect(v.provisionedAt).toBeUndefined();
      expect(v.invitedAt).toBeUndefined();
      expect(v.inviteExpiresAt).toBeUndefined();
    }
    expect(values[0].phone).toBe("+15550001111");
    expect(values[1].phone).toBeNull(); // empty string normalized to null
  });

  it("excludes a row that lost the unique-email race from the result", async () => {
    // Only "a@acme.com" actually landed — onConflictDoNothing dropped "b".
    mockState.insertedUsersReturn = [{ userId: "u-1", email: "a@acme.com" }];

    const result = await createCustomerImportStubs(
      [
        { name: "A", email: "a@acme.com", phone: "", organizationId: "org-1" },
        { name: "B", email: "b@acme.com", phone: "", organizationId: "org-1" },
      ],
      "admin-1",
    );

    expect(result).toEqual([{ userId: "u-1", email: "a@acme.com" }]);
  });
});

describe("finishCustomerProvisioning", () => {
  it("grants the role, creates the accounts row, and sets provisionedAt in one transaction", async () => {
    const result = await finishCustomerProvisioning({
      userId: "u-1",
      email: "a@acme.com",
      roleIds: ["role-customer-1"],
      createdById: "admin-1",
    });

    expect(result).toEqual({ ok: true, isCustomer: true });
    expect(mockState.txInsertCalls).toContainEqual(
      expect.objectContaining({
        table: "accounts",
        values: expect.objectContaining({ userId: "u-1", providerId: "credential" }),
      }),
    );
    expect(mockState.txInsertCalls).toContainEqual(
      expect.objectContaining({
        table: "user_roles",
        values: [expect.objectContaining({ userId: "u-1", roleId: "role-customer-1" })],
      }),
    );
    expect(mockState.txUpdateCalls).toContainEqual(
      expect.objectContaining({
        table: "users",
        values: { provisionedAt: expect.any(Date) },
      }),
    );
    expect(mockState.claimTicketsForCustomer).toHaveBeenCalledWith("u-1", "a@acme.com");
  });

  it("does not claim tickets when the granted role isn't Customer", async () => {
    mockState.customerRoleRows = []; // roleIds won't match "Customer" by name
    const result = await finishCustomerProvisioning({
      userId: "u-1",
      email: "a@acme.com",
      roleIds: ["role-technician-1"],
      createdById: "admin-1",
    });

    expect(result).toEqual({ ok: true, isCustomer: false });
    expect(mockState.claimTicketsForCustomer).not.toHaveBeenCalled();
  });

  it("returns ok:false and skips ticket-claiming when the transaction fails", async () => {
    mockState.txShouldThrow = true;
    const result = await finishCustomerProvisioning({
      userId: "u-1",
      email: "a@acme.com",
      roleIds: ["role-customer-1"],
      createdById: "admin-1",
    });

    expect(result.ok).toBe(false);
    expect(mockState.claimTicketsForCustomer).not.toHaveBeenCalled();
  });
});
