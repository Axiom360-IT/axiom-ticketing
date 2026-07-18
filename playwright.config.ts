import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so setup/specs can read the seeded admin credentials
// (INITIAL_SUPER_ADMIN_EMAIL / _PASSWORD) and the app can reach the DB.
loadEnv({ path: ".env.local" });

// Lives outside vitest's `src/**/*.test.ts` glob — `pnpm test` keeps
// running unit tests; `pnpm test:e2e` runs this suite. CI can opt in
// when an environment + DB are available.

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

const AUTH_STATE = "e2e/.auth/admin.json";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // A dev server compiles each route on first hit (and cold server actions do
  // Better Auth + bcrypt + DB round-trips), so give tests + assertions headroom.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Logs in once and saves the admin session for the authed project.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Public surfaces (a11y) — no session, so /admin/login stays reachable.
    {
      name: "public",
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Authenticated admin surfaces — reuse the saved session.
    {
      name: "authed",
      testMatch: /.*\.authed\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },
  ],
  // Boot a Next.js dev server for the suite — disabled when an
  // external BASE_URL is provided (e.g. an already-running dev server).
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
