import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/admin.json";

// Log in once as the seeded Super Admin and persist the session so the
// authed feature specs don't each re-authenticate (which would also risk the
// account-lockout after repeated attempts).
setup("authenticate as admin", async ({ page }) => {
  mkdirSync("e2e/.auth", { recursive: true });

  const email = process.env.INITIAL_SUPER_ADMIN_EMAIL;
  const password = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set INITIAL_SUPER_ADMIN_EMAIL / INITIAL_SUPER_ADMIN_PASSWORD in .env.local to run authed E2E.",
    );
  }

  await page.goto("/admin/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // On success the form does a hard navigation to /admin. The first cold
  // sign-in (route compile + Better Auth + bcrypt) can take a while.
  await page.waitForURL(/\/admin(\/|$)(?!login)/, { timeout: 100_000 });
  await expect(page).not.toHaveURL(/\/admin\/login/);

  await page.context().storageState({ path: AUTH_FILE });
});
