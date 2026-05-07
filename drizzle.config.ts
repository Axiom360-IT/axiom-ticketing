import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local for local drizzle-kit runs (generate, migrate, push, studio).
// In CI / Vercel build, env vars are injected directly by the platform.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
