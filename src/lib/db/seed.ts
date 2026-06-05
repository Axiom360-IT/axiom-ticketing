/**
 * Database seed script — seeds the canonical foundational data:
 * - 5 default roles (Super Admin, IT Director, Coordinator, Technician, Customer)
 * - role_permissions per PRD §5.11
 * - 31 default settings rows
 *
 * Idempotent: if any roles already exist, the script exits without changes.
 *
 * Run with:  pnpm db:seed
 *
 * The initial Super Admin USER is NOT seeded here — it's created via Better Auth
 * after the auth library is configured (see `src/lib/db/seed-super-admin.ts`).
 */

import {
  ALL_PERMISSIONS,
  COORDINATOR_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  IT_DIRECTOR_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
} from "../auth/permissions";
import { db } from "./client";
import { rolePermissions, roles } from "./schema/rbac";
import { settings } from "./schema/settings";

const ROLES = [
  {
    name: "Super Admin",
    description:
      "Top-level control. All permissions across all modules. Mandatory 2FA. Cannot be deleted.",
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "IT Director",
    description:
      "Senior oversight on escalated tickets. Can comment, reassign, take over. Cannot modify settings.",
    permissions: IT_DIRECTOR_PERMISSIONS,
  },
  {
    name: "Coordinator",
    description:
      "Dispatcher. Assigns tickets, approves procurement, creates tickets on behalf of customers.",
    permissions: COORDINATOR_PERMISSIONS,
  },
  {
    name: "Technician",
    description:
      "Resolves assigned tickets. Updates status, can request hardware/software, can escalate.",
    permissions: TECHNICIAN_PERMISSIONS,
  },
  {
    name: "Customer",
    description:
      "Submits tickets, replies to messages, requests purchases, confirms resolution.",
    permissions: CUSTOMER_PERMISSIONS,
  },
];

const DEFAULT_SETTINGS: { key: string; value: unknown; description: string }[] =
  [
    // Business hours (per ARCHITECTURE §27)
    {
      key: "business_hours.timezone",
      value: "America/Toronto",
      description: "IANA timezone for SLA business-hours computation",
    },
    {
      key: "business_hours.start_hour",
      value: 9,
      description: "Business hours start (0-23)",
    },
    {
      key: "business_hours.end_hour",
      value: 18,
      description: "Business hours end (0-23, exclusive)",
    },
    {
      key: "business_hours.working_days",
      value: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      description: "Working days for SLA computation",
    },

    // SLA business-hours flags per priority. Time targets are NOT seeded —
    // admin sets them via the Settings panel before the SLA monitor activates.
    {
      key: "sla.critical.respect_business_hours",
      value: false,
      description: "Critical tickets bypass business hours (24/7)",
    },
    {
      key: "sla.high.respect_business_hours",
      value: true,
      description: "High-priority tickets respect business hours",
    },
    {
      key: "sla.medium.respect_business_hours",
      value: true,
      description: "Medium-priority tickets respect business hours",
    },
    {
      key: "sla.low.respect_business_hours",
      value: true,
      description: "Low-priority tickets respect business hours",
    },

    // Email + stream tagging
    {
      key: "internal_email_domains",
      value: [],
      description:
        "Email domains considered internal — submitter emails matching these are auto-tagged stream=internal",
    },
    {
      key: "customer_response_window_hours",
      value: 24,
      description:
        "Hours before resolved tickets auto-close without CSAT response",
    },
    {
      key: "support_email",
      value: "support@axiom360.it",
      description: "Public-facing support email",
    },
    {
      key: "inbound_email_domain",
      value: "axiom360.it",
      description: "Domain used for inbound email Reply-To routing",
    },
    {
      key: "inbound_sender_allowlist_only",
      value: false,
      description:
        "If true, only accept inbound emails from registered customer accounts",
    },
    {
      key: "default_sender_name",
      value: "Axiom360 Support",
      description: "Display name for outbound emails",
    },
    {
      key: "default_sender_email",
      value: "support@axiom360.it",
      description: "From address for outbound emails",
    },

    // Procurement
    {
      key: "procurement_approval_threshold",
      value: 0,
      description:
        "Cost above which procurement requires Super Admin approval (0 = single-step Coordinator approval only)",
    },

    // Billing / accountant notifications (reqs 8.6–8.9)
    {
      key: "billing.accountant_emails",
      value: [],
      description:
        "Accountant email addresses that receive negative-balance and ticket-billing notifications",
    },
    {
      key: "billing.accountant_phones",
      value: [],
      description:
        "Accountant phone numbers (E.164) that receive the negative-balance SMS",
    },
    {
      key: "billing.superadmin_receive_copy",
      value: false,
      description:
        "Also send accountant billing notifications to active Super Admins",
    },

    // Public rate limits
    {
      key: "rate_limits.public_submit",
      value: { per_ip_per_hour: 5, per_email_per_day: 20 },
      description: "Rate limit for /portal/submit",
    },
    {
      key: "rate_limits.login",
      value: { per_ip_per_minute: 5 },
      description: "Rate limit for login endpoints",
    },
    {
      key: "rate_limits.password_reset",
      value: { per_email_per_hour: 3, per_ip_per_hour: 10 },
      description: "Rate limit for password reset requests",
    },
    {
      key: "rate_limits.guest_portal",
      value: { per_token_per_minute: 60 },
      description: "Rate limit for guest portal token-authenticated views",
    },

    // Authenticated user rate limits (per ARCHITECTURE §13.3)
    {
      key: "rate_limits.authenticated.create_ticket",
      value: { per_user_per_hour: 100 },
      description: "Authenticated ticket creation limit",
    },
    {
      key: "rate_limits.authenticated.reply",
      value: { per_user_per_hour: 200 },
      description: "Authenticated reply limit",
    },
    {
      key: "rate_limits.authenticated.internal_note",
      value: { per_user_per_hour: 200 },
      description: "Authenticated internal-note limit",
    },
    {
      key: "rate_limits.authenticated.escalate",
      value: { per_user_per_hour: 50 },
      description: "Authenticated escalation limit",
    },
    {
      key: "rate_limits.authenticated.create_proc",
      value: { per_user_per_day: 50 },
      description: "Authenticated procurement creation limit",
    },
    {
      key: "rate_limits.authenticated.create_user",
      value: { per_user_per_hour: 50 },
      description: "Authenticated user creation limit",
    },
    {
      key: "rate_limits.authenticated.create_role",
      value: { per_user_per_day: 20 },
      description: "Authenticated role creation limit",
    },
    {
      key: "rate_limits.authenticated.update_setting",
      value: { per_user_per_day: 100 },
      description: "Authenticated settings update limit",
    },

    // File uploads
    {
      key: "file_upload.max_size_bytes",
      value: 10_485_760,
      description: "Max attachment size in bytes (10 MB)",
    },
    {
      key: "file_upload.max_files_per_message",
      value: 5,
      description: "Max attachments per ticket message",
    },
    {
      key: "file_upload.allowed_mime_types",
      value: [
        "image/png",
        "image/jpeg",
        "image/gif",
        "application/pdf",
        "video/mp4",
      ],
      description: "Allowed MIME types for attachment uploads",
    },

    // Virus scanning (architecture in place; off by default)
    {
      key: "virus_scan.enabled",
      value: false,
      description: "Enable ClamAV scan on uploaded attachments",
    },
    {
      key: "virus_scan.provider",
      value: "disabled",
      description: "Scanner backend: disabled | eicar | clamav-rest",
    },
    {
      key: "virus_scan.endpoint",
      value: "",
      description: "HTTPS endpoint for the clamav-rest provider",
    },
  ];

async function seed() {
  console.log("Seeding database…");

  const existing = await db.select().from(roles).limit(1);
  if (existing.length > 0) {
    console.log(
      "Roles already exist; skipping seed. (Delete from roles to re-run.)",
    );
    return;
  }

  // Insert roles
  console.log(`Inserting ${ROLES.length} roles…`);
  const insertedRoles = await db
    .insert(roles)
    .values(
      ROLES.map((r) => ({
        name: r.name,
        description: r.description,
        isSystem: true,
      })),
    )
    .returning();

  const roleIdByName = Object.fromEntries(
    insertedRoles.map((r) => [r.name, r.id]),
  );

  // Insert role_permissions
  const allRolePermissions = ROLES.flatMap((r) =>
    r.permissions.map((permission) => ({
      roleId: roleIdByName[r.name],
      permission,
    })),
  );
  console.log(`Inserting ${allRolePermissions.length} role_permissions…`);
  await db.insert(rolePermissions).values(allRolePermissions);

  // Insert settings
  console.log(`Inserting ${DEFAULT_SETTINGS.length} settings…`);
  await db.insert(settings).values(
    DEFAULT_SETTINGS.map((s) => ({
      key: s.key,
      value: s.value,
      description: s.description,
    })),
  );

  console.log("✓ Seed complete.");
  console.log(
    `   ${insertedRoles.length} roles, ${allRolePermissions.length} role_permissions, ${DEFAULT_SETTINGS.length} settings`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
