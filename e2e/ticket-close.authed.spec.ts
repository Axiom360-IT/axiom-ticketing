import { expect, test, type Page } from "@playwright/test";

// Coverage for the Coordinator/IT Director/Super Admin manual ticket-close
// feature (`tickets.close`, added 2026-08-06). Driven as the seeded Super
// Admin — the only authenticated identity this suite has (see
// e2e/auth.setup.ts) — which holds `tickets.close` via ALL_PERMISSIONS.
// Role-based denial (Technician/Customer can't close) is covered at the
// permission-logic layer by src/lib/auth/can.test.ts instead of here, since
// this project's e2e setup only provisions one authenticated role.

async function openFirstTicketWithStatus(
  page: Page,
  status: string,
): Promise<boolean> {
  await page.goto(`/admin/tickets?status=${status}`);
  const link = page.locator('table a[href^="/admin/tickets/"]').first();
  if ((await link.count()) === 0) return false;
  await link.click();
  await page.waitForURL(/\/admin\/tickets\/[^/?]+$/);
  return true;
}

test.describe("Manual ticket close (tickets.close)", () => {
  test("Close ticket button is absent on a non-resolved ticket", async ({
    page,
  }) => {
    const opened = await openFirstTicketWithStatus(page, "open");
    test.skip(!opened, "No open ticket in the seeded dataset to check.");

    await expect(
      page.getByRole("button", { name: /^close ticket$/i }),
    ).toHaveCount(0);
  });

  test("Super Admin can manually close a resolved ticket, and reopen undoes it", async ({
    page,
  }) => {
    const opened = await openFirstTicketWithStatus(page, "resolved");
    test.skip(!opened, "No resolved ticket in the seeded dataset to close.");

    // Precondition: ticket is Resolved and the Close control is offered.
    await expect(page.getByText(/^Resolved$/).first()).toBeVisible();
    const closeButton = page.getByRole("button", { name: /^close ticket$/i });
    await expect(closeButton).toBeVisible();

    await closeButton.click();

    // The action does a router.refresh() on success — status flips to Closed
    // and the Close control disappears (a closed ticket can't be re-closed).
    await expect(page.getByText(/^Closed$/).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /^close ticket$/i }),
    ).toHaveCount(0);

    // Cleanup — reopen so the seeded ticket isn't left permanently closed by
    // the test run.
    const reopenButton = page.getByRole("button", { name: /^reopen ticket$/i });
    await expect(reopenButton).toBeVisible();
    await reopenButton.click();
    await expect(page.getByText(/^Closed$/).first()).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
