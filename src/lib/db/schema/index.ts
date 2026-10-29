// Re-exports every schema module so consumers can do:
//   import { tickets, users } from "@/lib/db/schema";

export * from "./auth";
export * from "./rbac";
export * from "./organizations";
export * from "./organization-trusted-emails";
export * from "./tickets";
export * from "./ticket-categories";
export * from "./ticket-types";
export * from "./ticket-assignees";
export * from "./ticket-participants";
export * from "./ticket-reviews";
export * from "./ticket-email-refs";
export * from "./work-logs";
export * from "./messages";
export * from "./attachments";
export * from "./procurement";
export * from "./vendors";
export * from "./audit";
export * from "./audit-filter-presets";
export * from "./mcp-tokens";
export * from "./notifications";
export * from "./email-template-overrides";
export * from "./settings";
export * from "./webhooks";
export * from "./failed-notifications";
export * from "./holidays";
// NOTE: everything the app has must be listed here, not just what the app
// imports. `drizzle.config.ts` points drizzle-kit at THIS file, so a table
// that is missing looks to `db:push` like a table that should be dropped.
// `automations` was absent until the rule engine landed; nobody had run
// `db:push` since, which is the only reason it went unnoticed.
export * from "./automations";
export * from "./automation-rules";
export * from "./email-delivery";
