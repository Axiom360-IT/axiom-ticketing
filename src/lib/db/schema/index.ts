// Re-exports every schema module so consumers can do:
//   import { tickets, users } from "@/lib/db/schema";

export * from "./auth";
export * from "./rbac";
export * from "./organizations";
export * from "./organization-trusted-emails";
export * from "./tickets";
export * from "./ticket-assignees";
export * from "./ticket-participants";
export * from "./work-logs";
export * from "./messages";
export * from "./attachments";
export * from "./procurement";
export * from "./audit";
export * from "./notifications";
export * from "./settings";
export * from "./webhooks";
export * from "./failed-notifications";
export * from "./holidays";
