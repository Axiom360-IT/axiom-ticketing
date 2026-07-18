import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// End-to-end coverage of the features built this session, driven as an
// authenticated Super Admin against the running app. Read-only: navigation,
// URL-driven filters, and export downloads — no destructive mutations.

const SHOT_DIR = "/tmp/pw-shots";

async function openExport(page: Page) {
  await page.getByRole("button", { name: /^export$/i }).click();
}

async function downloadVia(page: Page, itemName: RegExp) {
  await openExport(page);
  const item = page.getByRole("menuitem", { name: itemName });
  const waitDownload = page.waitForEvent("download");
  await item.click();
  return await waitDownload;
}

test.describe("Dashboard", () => {
  test("landing renders welcome + global stats + charts", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/total tickets/i)).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/dashboard.png`, fullPage: true });
  });

  test("oversight panels present when data warrants", async ({ page }) => {
    await page.goto("/admin");
    // These panels hide-when-empty; the DB has breached/at-risk + escalated
    // tickets, so at least the SLA board should be present. Soft-assert so a
    // quiet data state doesn't fail the run, but log what rendered.
    const sla = page.getByRole("heading", { name: /SLA deadlines/i });
    const esc = page.getByRole("heading", { name: /Escalations/i });
    const slaVisible = await sla.isVisible().catch(() => false);
    const escVisible = await esc.isVisible().catch(() => false);
    console.log(`  [dashboard] SLA board=${slaVisible} escalations=${escVisible}`);
    expect(slaVisible || escVisible).toBeTruthy();
  });
});

test.describe("Reports — date range + exports", () => {
  test("date-range filter scopes the report", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page.getByRole("heading", { name: /^Reports$/i })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/reports.png`, fullPage: true });

    // Apply a From/To range → URL updates and an "In period" figure appears.
    // Exact match: "To" is a case-insensitive substring of chart legends
    // ("cus{To}mer_confirmation") and the Next.js "Dev {To}ols" button.
    // Fill both back-to-back (no wait between) to exercise UrlDateRange's
    // rapid-change hardening: both params must survive, not just the last one.
    await page.getByLabel("From", { exact: true }).fill("2026-07-01");
    await page.getByLabel("To", { exact: true }).fill("2026-07-17");
    await expect(page).toHaveURL(/from=2026-07-01/);
    await expect(page).toHaveURL(/to=2026-07-17/);
    await expect(page.getByText(/in period/i).first()).toBeVisible();
    await page.screenshot({
      path: `${SHOT_DIR}/reports-ranged.png`,
      fullPage: true,
    });
  });

  test("exports as PDF, XLSX and CSV (proves pdfkit/exceljs in the bundled route)", async ({
    page,
  }) => {
    await page.goto("/admin/reports");
    const pdf = await downloadVia(page, /PDF/);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const pdfBytes = readFileSync(await pdf.path());
    expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const xlsx = await downloadVia(page, /Excel/);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    expect(readFileSync(await xlsx.path()).length).toBeGreaterThan(2000);

    const csv = await downloadVia(page, /CSV/);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    expect(readFileSync(await csv.path(), "utf8")).toMatch(/IT Operations Report/);
  });

  test("ranged export carries the date range", async ({ page }) => {
    await page.goto("/admin/reports?from=2026-07-01&to=2026-07-17");
    await openExport(page);
    const href = await page
      .getByRole("menuitem", { name: /CSV/ })
      .getAttribute("href");
    expect(href).toContain("from=2026-07-01");
    expect(href).toContain("to=2026-07-17");
    expect(href).toContain("format=csv");
  });
});

test.describe("Tickets — filter-aware export", () => {
  test("export URL carries the applied status filter", async ({ page }) => {
    await page.goto("/admin/tickets?status=resolved");
    await expect(page.getByRole("heading", { name: /^Tickets$/i })).toBeVisible();
    await page.screenshot({
      path: `${SHOT_DIR}/tickets-filtered.png`,
      fullPage: true,
    });

    await openExport(page);
    const csvItem = page.getByRole("menuitem", { name: /CSV/ });
    const href = await csvItem.getAttribute("href");
    expect(href).toContain("status=resolved");
    expect(href).toContain("format=csv");

    // Download and confirm the export only contains resolved tickets.
    const waitDownload = page.waitForEvent("download");
    await csvItem.click();
    const dl = await waitDownload;
    const csv = readFileSync(await dl.path(), "utf8");
    expect(csv.toLowerCase()).toContain("resolved");
    expect(csv).not.toMatch(/,in_progress,/);
    expect(csv).not.toMatch(/,awaiting_customer_confirmation,/);
  });

  test("tickets exports a landscape PDF", async ({ page }) => {
    await page.goto("/admin/tickets");
    const pdf = await downloadVia(page, /PDF/);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    expect(readFileSync(await pdf.path()).subarray(0, 5).toString("latin1")).toBe(
      "%PDF-",
    );
  });
});

test.describe("Procurement + Audit exports", () => {
  test("procurement export downloads", async ({ page }) => {
    await page.goto("/admin/procurement");
    const csv = await downloadVia(page, /CSV/);
    expect(csv.suggestedFilename()).toMatch(/procurement.*\.csv$/);
  });

  test("audit export downloads (streamed CSV + XLSX)", async ({ page }) => {
    await page.goto("/admin/audit");
    const csv = await downloadVia(page, /CSV/);
    expect(csv.suggestedFilename()).toMatch(/audit.*\.csv$/);
    const xlsx = await downloadVia(page, /Excel/);
    expect(xlsx.suggestedFilename()).toMatch(/audit.*\.xlsx$/);
  });
});

test.describe("Settings — customer follow-up", () => {
  test("follow-up + auto-close settings card renders", async ({ page }) => {
    // The settings page is tabbed; the follow-up card lives on the Tickets tab.
    await page.goto("/admin/settings?tab=tickets");
    await expect(
      page.getByText(/Customer follow-up & auto-close/i),
    ).toBeVisible();
    await expect(page.getByText(/Send follow-up after \(days\)/i)).toBeVisible();
    await expect(page.getByText(/Auto-close after \(days\)/i)).toBeVisible();
    await page
      .getByText(/Customer follow-up & auto-close/i)
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${SHOT_DIR}/settings-followup.png`,
    });
  });
});
