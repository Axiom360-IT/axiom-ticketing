/**
 * Demo seed script — populates the database with a realistic mix of users,
 * tickets, messages, procurement requests, audit entries, notifications,
 * holidays, and failed-notification rows so every admin page has data to
 * render. Designed to be run AFTER `db:seed` and `db:seed-super-admin`.
 *
 *   pnpm db:seed-demo
 *
 * Idempotent: if the demo Coordinator already exists, the script exits.
 *
 * Demo passwords are all `DemoPassw0rd!` — never enable this seed in
 * production environments.
 */

import { eq, inArray } from "drizzle-orm";
import { auth } from "../auth/index";
import { db } from "./client";
import {
  attachments,
  auditLog,
  failedNotifications,
  holidays,
  messages,
  notificationPreferences,
  notifications,
  procurementRequests,
  roles,
  tickets,
  userRoles,
  users,
} from "./schema";
import { generateTicketNumber } from "../ticket-number";

const DEMO_PASSWORD = "DemoPassw0rd!";

type DemoUserSpec = {
  email: string;
  name: string;
  roleName: "IT Director" | "Coordinator" | "Technician" | "Customer";
  phone?: string;
};

const DEMO_USERS: DemoUserSpec[] = [
  {
    email: "director@axiom360.it",
    name: "Diana Director",
    roleName: "IT Director",
    phone: "+14165550101",
  },
  {
    email: "coordinator@axiom360.it",
    name: "Carlos Coordinator",
    roleName: "Coordinator",
    phone: "+14165550102",
  },
  {
    email: "alice.tech@axiom360.it",
    name: "Alice Technician",
    roleName: "Technician",
    phone: "+14165550103",
  },
  {
    email: "bob.tech@axiom360.it",
    name: "Bob Technician",
    roleName: "Technician",
    phone: "+14165550104",
  },
  {
    email: "emma@example.com",
    name: "Emma Customer",
    roleName: "Customer",
  },
  {
    email: "frank@example.com",
    name: "Frank Customer",
    roleName: "Customer",
    phone: "+14165550105",
  },
];

function daysAgo(days: number, hour = 9): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function findUserByEmail(email: string): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function ensureUser(spec: DemoUserSpec): Promise<string> {
  const existing = await findUserByEmail(spec.email);
  if (existing) {
    if (spec.phone) {
      await db
        .update(users)
        .set({ phone: spec.phone })
        .where(eq(users.id, existing));
    }
    return existing;
  }

  const result = await auth.api.signUpEmail({
    body: { email: spec.email, password: DEMO_PASSWORD, name: spec.name },
  });
  if (!result.user) throw new Error(`signUpEmail returned no user for ${spec.email}`);

  if (spec.phone) {
    await db
      .update(users)
      .set({ phone: spec.phone })
      .where(eq(users.id, result.user.id));
  }
  return result.user.id;
}

async function ensureUserRole(userId: string, roleName: string): Promise<void> {
  const role = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, roleName))
    .limit(1);
  if (role.length === 0) {
    throw new Error(`Role "${roleName}" not seeded — run db:seed first.`);
  }
  await db
    .insert(userRoles)
    .values({ userId, roleId: role[0].id, assignedById: null })
    .onConflictDoNothing();
}

async function seedTickets(userIds: Record<string, string>) {
  const aliceId = userIds["alice.tech@axiom360.it"];
  const bobId = userIds["bob.tech@axiom360.it"];
  const carlosId = userIds["coordinator@axiom360.it"];
  const dianaId = userIds["director@axiom360.it"];
  const emmaId = userIds["emma@example.com"];
  const frankId = userIds["frank@example.com"];

  type TicketSeed = {
    subject: string;
    description: string;
    category: "hardware" | "software" | "network" | "access" | "other";
    priority: "low" | "medium" | "high" | "critical";
    status: "open" | "in_progress" | "resolved" | "closed";
    stream: "internal" | "external";
    origin: "web_form" | "email" | "portal";
    customerId: string | null;
    customerEmail: string;
    customerName: string;
    assignedToId?: string | null;
    isEscalated?: boolean;
    escalationReason?:
      | "beyond_scope"
      | "requires_access"
      | "critical_impact"
      | "vendor_involvement"
      | "other";
    escalationNote?: string;
    escalatedById?: string;
    csatResponse?: "satisfied" | "unsatisfied";
    createdAt: Date;
    resolvedAt?: Date;
    closedAt?: Date;
    firstResponseAt?: Date;
    responseDueAt?: Date;
    resolutionDueAt?: Date;
    slaWarning50At?: Date;
    slaWarning80At?: Date;
    slaBreachedAt?: Date;
    replies: Array<{
      authorId: string | null;
      authorEmail: string;
      authorName: string;
      authorType: "agent" | "customer" | "system";
      channel: "email" | "portal" | "dashboard" | "system";
      body: string;
      isInternalNote?: boolean;
      isResolutionNote?: boolean;
      offsetMinutes: number;
    }>;
  };

  const seeds: TicketSeed[] = [
    {
      subject: "Laptop won't boot after Windows update",
      description:
        "My ThinkPad freezes on the BIOS splash screen since this morning's update. Tried hard reboot a few times, no luck.",
      category: "hardware",
      priority: "high",
      status: "in_progress",
      stream: "internal",
      origin: "web_form",
      customerId: emmaId,
      customerEmail: "emma@example.com",
      customerName: "Emma Customer",
      assignedToId: aliceId,
      createdAt: hoursAgo(6),
      firstResponseAt: hoursAgo(5),
      responseDueAt: hoursFromNow(2),
      resolutionDueAt: hoursFromNow(18),
      slaWarning50At: hoursAgo(2),
      replies: [
        {
          authorId: aliceId,
          authorEmail: "alice.tech@axiom360.it",
          authorName: "Alice Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "Hi Emma — I'll start by collecting the BIOS logs. Can you confirm whether you see a manufacturer logo or a black screen?",
          offsetMinutes: 60,
        },
        {
          authorId: emmaId,
          authorEmail: "emma@example.com",
          authorName: "Emma Customer",
          authorType: "customer",
          channel: "portal",
          body: "Lenovo logo for ~10 seconds, then a blinking cursor. Nothing else.",
          offsetMinutes: 90,
        },
        {
          authorId: aliceId,
          authorEmail: "alice.tech@axiom360.it",
          authorName: "Alice Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "Sounds like a corrupted boot sector from the patch. I'll book a swap-out laptop for tomorrow morning.",
          isInternalNote: true,
          offsetMinutes: 120,
        },
      ],
    },
    {
      subject: "Cannot access shared finance drive",
      description:
        "Mapping \\\\fileserver\\finance returns access denied. Worked yesterday.",
      category: "access",
      priority: "medium",
      status: "open",
      stream: "internal",
      origin: "email",
      customerId: frankId,
      customerEmail: "frank@example.com",
      customerName: "Frank Customer",
      assignedToId: null,
      createdAt: hoursAgo(2),
      responseDueAt: hoursFromNow(6),
      resolutionDueAt: hoursFromNow(46),
      replies: [],
    },
    {
      subject: "Wi-Fi keeps dropping in the boardroom",
      description:
        "During this morning's exec sync the Wi-Fi disconnected ~5 times. Other floors are fine.",
      category: "network",
      priority: "critical",
      status: "in_progress",
      stream: "internal",
      origin: "web_form",
      customerId: emmaId,
      customerEmail: "emma@example.com",
      customerName: "Emma Customer",
      assignedToId: bobId,
      isEscalated: true,
      escalationReason: "critical_impact",
      escalationNote: "Repeated outages affecting executive meetings.",
      escalatedById: dianaId,
      createdAt: hoursAgo(3),
      firstResponseAt: hoursAgo(2),
      responseDueAt: hoursAgo(1),
      resolutionDueAt: hoursFromNow(1),
      slaWarning50At: hoursAgo(2),
      slaWarning80At: hoursAgo(1),
      slaBreachedAt: hoursAgo(1),
      replies: [
        {
          authorId: bobId,
          authorEmail: "bob.tech@axiom360.it",
          authorName: "Bob Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "On site. AP-3F-01 is showing intermittent radio errors — checking power and bringing a spare.",
          offsetMinutes: 60,
        },
        {
          authorId: dianaId,
          authorEmail: "director@axiom360.it",
          authorName: "Diana Director",
          authorType: "agent",
          channel: "dashboard",
          body: "Escalating — leadership meeting at 4pm needs a stable connection.",
          isInternalNote: true,
          offsetMinutes: 80,
        },
      ],
    },
    {
      subject: "Adobe Creative Cloud licence expired",
      description:
        "I get 'Subscription has expired' when launching Photoshop. Need urgent renewal.",
      category: "software",
      priority: "medium",
      status: "resolved",
      stream: "internal",
      origin: "portal",
      customerId: emmaId,
      customerEmail: "emma@example.com",
      customerName: "Emma Customer",
      assignedToId: aliceId,
      createdAt: daysAgo(3, 9),
      firstResponseAt: daysAgo(3, 10),
      resolvedAt: daysAgo(2, 14),
      responseDueAt: daysAgo(3, 13),
      resolutionDueAt: daysAgo(2, 17),
      csatResponse: "satisfied",
      replies: [
        {
          authorId: aliceId,
          authorEmail: "alice.tech@axiom360.it",
          authorName: "Alice Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "Renewing your seat now — should propagate within ~15 minutes.",
          offsetMinutes: 60,
        },
        {
          authorId: aliceId,
          authorEmail: "alice.tech@axiom360.it",
          authorName: "Alice Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "Licence assigned and confirmed active. Closing out.",
          isResolutionNote: true,
          offsetMinutes: 60 * 28,
        },
      ],
    },
    {
      subject: "Printer queue stuck on 3rd floor",
      description: "All print jobs since 10am have queued but nothing prints.",
      category: "hardware",
      priority: "low",
      status: "closed",
      stream: "internal",
      origin: "email",
      customerId: frankId,
      customerEmail: "frank@example.com",
      customerName: "Frank Customer",
      assignedToId: bobId,
      createdAt: daysAgo(7, 10),
      firstResponseAt: daysAgo(7, 11),
      resolvedAt: daysAgo(6, 16),
      closedAt: daysAgo(5, 16),
      responseDueAt: daysAgo(7, 18),
      resolutionDueAt: daysAgo(6, 18),
      csatResponse: "unsatisfied",
      replies: [
        {
          authorId: bobId,
          authorEmail: "bob.tech@axiom360.it",
          authorName: "Bob Technician",
          authorType: "agent",
          channel: "dashboard",
          body: "Cleared queue, restarted spooler. Test job printed OK.",
          isResolutionNote: true,
          offsetMinutes: 60 * 30,
        },
      ],
    },
    {
      subject: "VPN client crashes on macOS Sonoma",
      description:
        "Cisco AnyConnect quits the moment I authenticate. Reinstalled twice already.",
      category: "software",
      priority: "high",
      status: "open",
      stream: "internal",
      origin: "portal",
      customerId: emmaId,
      customerEmail: "emma@example.com",
      customerName: "Emma Customer",
      assignedToId: null,
      createdAt: hoursAgo(1),
      responseDueAt: hoursFromNow(3),
      resolutionDueAt: hoursFromNow(23),
      replies: [],
    },
    {
      subject: "Request: external monitor for hot-desk #14",
      description:
        "Hot-desk 14 only has an HDMI cable but no second monitor. Could we add one?",
      category: "other",
      priority: "low",
      status: "in_progress",
      stream: "internal",
      origin: "portal",
      customerId: frankId,
      customerEmail: "frank@example.com",
      customerName: "Frank Customer",
      assignedToId: carlosId,
      createdAt: daysAgo(2, 11),
      firstResponseAt: daysAgo(2, 12),
      responseDueAt: daysAgo(1, 11),
      resolutionDueAt: hoursFromNow(72),
      replies: [
        {
          authorId: carlosId,
          authorEmail: "coordinator@axiom360.it",
          authorName: "Carlos Coordinator",
          authorType: "agent",
          channel: "dashboard",
          body: "Filing a procurement request for a 27\" monitor. Will update once approved.",
          offsetMinutes: 60,
        },
      ],
    },
  ];

  console.log(`Inserting ${seeds.length} tickets…`);
  const ticketIds: Record<number, string> = {};

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const ticketNumber = await generateTicketNumber();
    const [row] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        subject: s.subject,
        description: s.description,
        category: s.category,
        priority: s.priority,
        status: s.status,
        stream: s.stream,
        origin: s.origin,
        customerId: s.customerId,
        customerEmail: s.customerEmail,
        customerName: s.customerName,
        assignedToId: s.assignedToId ?? null,
        assignedAt: s.assignedToId ? s.createdAt : null,
        isEscalated: s.isEscalated ?? false,
        escalatedAt: s.isEscalated ? s.createdAt : null,
        escalatedById: s.escalatedById ?? null,
        escalationReason: s.escalationReason ?? null,
        escalationNote: s.escalationNote ?? null,
        firstResponseAt: s.firstResponseAt ?? null,
        responseDueAt: s.responseDueAt ?? null,
        resolutionDueAt: s.resolutionDueAt ?? null,
        slaWarning50At: s.slaWarning50At ?? null,
        slaWarning80At: s.slaWarning80At ?? null,
        slaBreachedAt: s.slaBreachedAt ?? null,
        resolvedAt: s.resolvedAt ?? null,
        closedAt: s.closedAt ?? null,
        csatResponse: s.csatResponse ?? null,
        csatRespondedAt: s.csatResponse
          ? (s.closedAt ?? s.resolvedAt ?? null)
          : null,
        createdAt: s.createdAt,
        updatedAt: s.resolvedAt ?? s.createdAt,
      })
      .returning({ id: tickets.id });
    ticketIds[i] = row.id;

    if (s.replies.length > 0) {
      await db.insert(messages).values(
        s.replies.map((r) => ({
          ticketId: row.id,
          authorId: r.authorId,
          authorEmail: r.authorEmail,
          authorName: r.authorName,
          authorType: r.authorType,
          channel: r.channel,
          body: r.body,
          isInternalNote: r.isInternalNote ?? false,
          isResolutionNote: r.isResolutionNote ?? false,
          createdAt: new Date(s.createdAt.getTime() + r.offsetMinutes * 60_000),
        })),
      );
    }
  }

  return { ticketIds, count: seeds.length };
}

async function seedProcurement(
  ticketIds: Record<number, string>,
  userIds: Record<string, string>,
) {
  const aliceId = userIds["alice.tech@axiom360.it"];
  const bobId = userIds["bob.tech@axiom360.it"];
  const carlosId = userIds["coordinator@axiom360.it"];
  const dianaId = userIds["director@axiom360.it"];
  const superAdminId = userIds.__superAdmin;

  const rows = [
    {
      ticketId: ticketIds[6],
      requestedById: carlosId,
      requestedByEmail: "coordinator@axiom360.it",
      type: "hardware" as const,
      itemName: '27" 4K USB-C Monitor',
      quantity: 1,
      estimatedCost: "420.00",
      vendor: "Dell",
      justification: "Hot-desk #14 currently single-monitor; productivity hit.",
      urgency: "low" as const,
      dateNeededBy: isoDate(daysAgo(-14, 12)),
      status: "pending_coordinator_approval" as const,
      createdAt: daysAgo(2, 12),
    },
    {
      ticketId: ticketIds[0],
      requestedById: aliceId,
      requestedByEmail: "alice.tech@axiom360.it",
      type: "hardware" as const,
      itemName: "ThinkPad X1 Carbon (Gen 11)",
      quantity: 1,
      estimatedCost: "2350.00",
      vendor: "Lenovo",
      justification: "Replacement for Emma's failing laptop.",
      urgency: "high" as const,
      dateNeededBy: isoDate(daysAgo(-2, 12)),
      status: "pending_admin_approval" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: hoursAgo(3),
      createdAt: hoursAgo(5),
    },
    {
      ticketId: ticketIds[3],
      requestedById: aliceId,
      requestedByEmail: "alice.tech@axiom360.it",
      type: "software" as const,
      itemName: "Adobe Creative Cloud — All Apps (1 seat)",
      quantity: 1,
      estimatedCost: "780.00",
      vendor: "Adobe",
      justification: "Renewing Emma's expired licence.",
      urgency: "medium" as const,
      dateNeededBy: isoDate(daysAgo(-1, 12)),
      status: "approved" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: daysAgo(3, 11),
      adminDecisionById: superAdminId,
      adminDecisionAt: daysAgo(3, 12),
      createdAt: daysAgo(3, 10),
    },
    {
      ticketId: ticketIds[2],
      requestedById: bobId,
      requestedByEmail: "bob.tech@axiom360.it",
      type: "hardware" as const,
      itemName: "Cisco Meraki MR46 Access Point",
      quantity: 2,
      estimatedCost: "1990.00",
      vendor: "Cisco",
      justification: "Replace flaky boardroom AP and add coverage.",
      urgency: "high" as const,
      dateNeededBy: isoDate(daysAgo(-3, 12)),
      status: "purchased" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: hoursAgo(20),
      adminDecisionById: superAdminId,
      adminDecisionAt: hoursAgo(18),
      purchasedById: carlosId,
      purchasedAt: hoursAgo(2),
      createdAt: hoursAgo(22),
    },
    {
      ticketId: ticketIds[4],
      requestedById: bobId,
      requestedByEmail: "bob.tech@axiom360.it",
      type: "hardware" as const,
      itemName: "Toner cartridge HP 26X (pack of 2)",
      quantity: 1,
      estimatedCost: "180.00",
      vendor: "HP",
      justification: "Replenish printer supplies on 3rd floor.",
      urgency: "low" as const,
      dateNeededBy: isoDate(daysAgo(-7, 12)),
      status: "delivered" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: daysAgo(7, 11),
      adminDecisionById: superAdminId,
      adminDecisionAt: daysAgo(7, 12),
      purchasedById: carlosId,
      purchasedAt: daysAgo(6, 9),
      deliveredById: bobId,
      deliveredAt: daysAgo(5, 14),
      createdAt: daysAgo(7, 10),
    },
    {
      ticketId: ticketIds[5],
      requestedById: aliceId,
      requestedByEmail: "alice.tech@axiom360.it",
      type: "software" as const,
      itemName: "GlobalProtect VPN seat",
      quantity: 1,
      estimatedCost: "120.00",
      vendor: "Palo Alto Networks",
      justification: "Replace AnyConnect for macOS Sonoma compatibility.",
      urgency: "medium" as const,
      dateNeededBy: isoDate(daysAgo(-3, 12)),
      status: "rejected" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: hoursAgo(10),
      rejectionReason:
        "We have an org-wide VPN renewal in flight — hold and revisit next quarter.",
      rejectedAtStep: "coordinator" as const,
      createdAt: hoursAgo(12),
    },
    {
      ticketId: ticketIds[2],
      requestedById: dianaId,
      requestedByEmail: "director@axiom360.it",
      type: "hardware" as const,
      itemName: "Spare 24-port PoE switch",
      quantity: 1,
      estimatedCost: "5400.00",
      vendor: "Aruba",
      justification: "Cold-spare for boardroom outage recovery.",
      urgency: "medium" as const,
      dateNeededBy: isoDate(daysAgo(-30, 12)),
      status: "rejected" as const,
      coordinatorDecisionById: carlosId,
      coordinatorDecisionAt: daysAgo(1, 14),
      adminDecisionById: superAdminId,
      adminDecisionAt: daysAgo(1, 16),
      rejectionReason: "Outside this quarter's budget — defer to Q2 plan.",
      rejectedAtStep: "admin" as const,
      createdAt: daysAgo(2, 9),
    },
  ];

  console.log(`Inserting ${rows.length} procurement requests…`);
  await db.insert(procurementRequests).values(rows);
  return rows.length;
}

async function seedAttachments(ticketIds: Record<number, string>) {
  const rows = [
    {
      ticketId: ticketIds[2],
      uploadedByEmail: "bob.tech@axiom360.it",
      fileName: "ap-3f-01-error-log.txt",
      originalFileName: "ap-3f-01-error-log.txt",
      storageKey: "demo/ap-3f-01-error-log.txt",
      mimeType: "text/plain",
      sizeBytes: 4321,
      scanStatus: "clean" as const,
      scanCompletedAt: hoursAgo(1),
      uploadConfirmedAt: hoursAgo(1),
    },
    {
      ticketId: ticketIds[0],
      uploadedByEmail: "emma@example.com",
      fileName: "boot-screen.jpg",
      originalFileName: "IMG_4421.jpg",
      storageKey: "demo/boot-screen.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 287_540,
      scanStatus: "clean" as const,
      scanCompletedAt: hoursAgo(5),
      uploadConfirmedAt: hoursAgo(5),
    },
    {
      ticketId: ticketIds[3],
      uploadedByEmail: "alice.tech@axiom360.it",
      fileName: "license-confirmation.pdf",
      originalFileName: "license-confirmation.pdf",
      storageKey: "demo/license-confirmation.pdf",
      mimeType: "application/pdf",
      sizeBytes: 88_200,
      scanStatus: "quarantined" as const,
      scanCompletedAt: daysAgo(3, 11),
      uploadConfirmedAt: daysAgo(3, 11),
    },
  ];

  console.log(`Inserting ${rows.length} attachments…`);
  await db.insert(attachments).values(rows);
  return rows.length;
}

async function seedAuditLog(
  userIds: Record<string, string>,
  ticketIds: Record<number, string>,
) {
  const carlosId = userIds["coordinator@axiom360.it"];
  const dianaId = userIds["director@axiom360.it"];
  const aliceId = userIds["alice.tech@axiom360.it"];
  const superAdminId = userIds.__superAdmin;

  const rows = [
    {
      actorId: superAdminId,
      actorRoleSnapshot: "Super Admin",
      action: "user.create",
      targetType: "user",
      targetId: userIds["emma@example.com"],
      afterValue: { email: "emma@example.com", name: "Emma Customer" },
      timestamp: daysAgo(8, 9),
    },
    {
      actorId: carlosId,
      actorRoleSnapshot: "Coordinator",
      action: "ticket.assign",
      targetType: "ticket",
      targetId: ticketIds[0],
      beforeValue: { assignedToId: null },
      afterValue: { assignedToId: aliceId },
      timestamp: hoursAgo(5),
    },
    {
      actorId: dianaId,
      actorRoleSnapshot: "IT Director",
      action: "ticket.escalate",
      targetType: "ticket",
      targetId: ticketIds[2],
      afterValue: { reason: "Boardroom outage during exec sync." },
      timestamp: hoursAgo(1),
    },
    {
      actorId: superAdminId,
      actorRoleSnapshot: "Super Admin",
      action: "settings.update",
      targetType: "setting",
      targetId: "support_email",
      beforeValue: { value: "support@old.example" },
      afterValue: { value: "support@axiom360.it" },
      timestamp: daysAgo(15, 14),
    },
    {
      actorId: carlosId,
      actorRoleSnapshot: "Coordinator",
      action: "procurement.approve",
      targetType: "procurement_request",
      targetId: ticketIds[3],
      afterValue: { decision: "approved" },
      timestamp: daysAgo(3, 11),
    },
    {
      actorId: superAdminId,
      actorRoleSnapshot: "Super Admin",
      action: "role.update",
      targetType: "role",
      targetId: "Technician",
      beforeValue: { permissions: ["tickets.view", "tickets.update"] },
      afterValue: {
        permissions: [
          "tickets.view",
          "tickets.update",
          "tickets.reply",
          "tickets.resolve",
        ],
      },
      timestamp: daysAgo(20, 10),
    },
  ];

  console.log(`Inserting ${rows.length} audit log entries…`);
  await db.insert(auditLog).values(rows);
  return rows.length;
}

async function seedNotifications(
  userIds: Record<string, string>,
  ticketIds: Record<number, string>,
) {
  const aliceId = userIds["alice.tech@axiom360.it"];
  const bobId = userIds["bob.tech@axiom360.it"];
  const carlosId = userIds["coordinator@axiom360.it"];
  const dianaId = userIds["director@axiom360.it"];

  const rows = [
    {
      userId: aliceId,
      eventType: "ticket.assigned",
      titleKey: "notifications.ticket.assigned.title",
      titleArgs: { number: "AX-0001" },
      bodyKey: "notifications.ticket.assigned.body",
      bodyArgs: { subject: "Laptop won't boot after Windows update" },
      linkUrl: `/admin/tickets/${ticketIds[0]}`,
      isRead: false,
      createdAt: hoursAgo(5),
    },
    {
      userId: bobId,
      eventType: "ticket.escalated",
      titleKey: "notifications.ticket.escalated.title",
      titleArgs: { number: "AX-0003" },
      bodyKey: "notifications.ticket.escalated.body",
      bodyArgs: { subject: "Wi-Fi keeps dropping in the boardroom" },
      linkUrl: `/admin/tickets/${ticketIds[2]}`,
      isRead: false,
      createdAt: hoursAgo(1),
    },
    {
      userId: bobId,
      eventType: "sla.warning_80",
      titleKey: "notifications.sla.warning_80.title",
      titleArgs: { number: "AX-0003" },
      bodyKey: "notifications.sla.warning_80.body",
      bodyArgs: { subject: "Wi-Fi keeps dropping in the boardroom" },
      linkUrl: `/admin/tickets/${ticketIds[2]}`,
      isRead: false,
      createdAt: hoursAgo(2),
    },
    {
      userId: dianaId,
      eventType: "sla.breached",
      titleKey: "notifications.sla.breached.title",
      titleArgs: { number: "AX-0003" },
      bodyKey: "notifications.sla.breached.body",
      bodyArgs: { subject: "Wi-Fi keeps dropping in the boardroom" },
      linkUrl: `/admin/tickets/${ticketIds[2]}`,
      isRead: false,
      createdAt: hoursAgo(1),
    },
    {
      userId: carlosId,
      eventType: "procurement.submitted",
      titleKey: "notifications.procurement.submitted.title",
      titleArgs: { item: "ThinkPad X1 Carbon (Gen 11)" },
      bodyKey: "notifications.procurement.submitted.body",
      bodyArgs: { number: "AX-0001" },
      linkUrl: "/admin/procurement",
      isRead: true,
      readAt: hoursAgo(2),
      createdAt: hoursAgo(5),
    },
    {
      userId: aliceId,
      eventType: "procurement.approved",
      titleKey: "notifications.procurement.approved.title",
      titleArgs: { item: "Adobe Creative Cloud — All Apps (1 seat)" },
      bodyKey: "notifications.procurement.approved.body",
      bodyArgs: { number: "AX-0004" },
      linkUrl: "/admin/procurement",
      isRead: true,
      readAt: daysAgo(3, 13),
      createdAt: daysAgo(3, 12),
    },
    {
      userId: aliceId,
      eventType: "attachment.quarantined",
      titleKey: "notifications.attachment.quarantined.title",
      titleArgs: { number: "AX-0004" },
      bodyKey: "notifications.attachment.quarantined.body",
      bodyArgs: { fileName: "license-confirmation.pdf" },
      linkUrl: `/admin/tickets/${ticketIds[3]}`,
      isRead: false,
      createdAt: daysAgo(3, 11),
    },
  ];

  console.log(`Inserting ${rows.length} notifications…`);
  await db.insert(notifications).values(rows);

  console.log("Inserting notification preferences…");
  await db
    .insert(notificationPreferences)
    .values([
      { userId: aliceId, eventType: "sla.warning_80", emailEnabled: true, smsEnabled: false },
      { userId: aliceId, eventType: "sla.breached", emailEnabled: true, smsEnabled: true },
      { userId: bobId, eventType: "ticket.assigned", emailEnabled: true, smsEnabled: false },
    ])
    .onConflictDoNothing();

  return rows.length;
}

async function seedHolidays(superAdminId: string) {
  const year = new Date().getUTCFullYear();
  const rows = [
    { date: `${year}-01-01`, label: "New Year's Day" },
    { date: `${year}-07-01`, label: "Canada Day" },
    { date: `${year}-12-25`, label: "Christmas Day" },
    { date: `${year}-12-26`, label: "Boxing Day" },
  ];
  console.log(`Inserting ${rows.length} holidays…`);
  await db
    .insert(holidays)
    .values(rows.map((h) => ({ ...h, createdById: superAdminId })))
    .onConflictDoNothing();
  return rows.length;
}

async function seedFailedNotifications() {
  const rows = [
    {
      inngestEventId: "demo-evt-001",
      channel: "email",
      eventType: "ticket.assigned",
      recipient: "alice.tech@axiom360.it",
      payload: { ticketNumber: "AX-0001" },
      errorMessage: "Resend API: rate-limited (429) after 5 retries.",
      retryCount: 5,
      firstAttemptAt: daysAgo(2, 9),
      lastAttemptAt: daysAgo(2, 11),
    },
    {
      inngestEventId: "demo-evt-002",
      channel: "sms",
      eventType: "sla.breached",
      recipient: "+14165550103",
      payload: { ticketNumber: "AX-0003" },
      errorMessage: "Twilio: invalid 'From' number for region.",
      retryCount: 5,
      firstAttemptAt: hoursAgo(2),
      lastAttemptAt: hoursAgo(1),
    },
    {
      inngestEventId: "demo-evt-003",
      channel: "email",
      eventType: "procurement.approved",
      recipient: "frank@example.com",
      payload: { item: "27\" 4K Monitor" },
      errorMessage: "DNS: customer mailbox refused — bounce 5.1.1.",
      retryCount: 5,
      firstAttemptAt: daysAgo(1, 10),
      lastAttemptAt: daysAgo(1, 12),
      resolvedAt: daysAgo(1, 14),
    },
  ];

  console.log(`Inserting ${rows.length} failed notifications…`);
  await db.insert(failedNotifications).values(rows);
  return rows.length;
}

async function main() {
  console.log("Seeding demo data…");

  const coordinatorExisting = await findUserByEmail("coordinator@axiom360.it");
  if (coordinatorExisting) {
    console.log(
      "Demo coordinator already exists; skipping. (Drop demo users from `users` to re-run.)",
    );
    return;
  }

  // Find Super Admin (must be seeded already).
  const superAdminEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) {
    throw new Error(
      "INITIAL_SUPER_ADMIN_EMAIL is required (seed Super Admin first via db:seed-super-admin).",
    );
  }
  const superAdminId = await findUserByEmail(superAdminEmail);
  if (!superAdminId) {
    throw new Error(
      `Super Admin user ${superAdminEmail} not found. Run db:seed-super-admin first.`,
    );
  }

  // Create users + assign roles.
  console.log(`Creating ${DEMO_USERS.length} demo users…`);
  const userIds: Record<string, string> = { __superAdmin: superAdminId };
  for (const spec of DEMO_USERS) {
    const id = await ensureUser(spec);
    await ensureUserRole(id, spec.roleName);
    userIds[spec.email] = id;
    console.log(`  ✓ ${spec.email} → ${spec.roleName}`);
  }

  // Mark a couple of users with last-login + lockout state to exercise UI.
  await db
    .update(users)
    .set({ lastLoginAt: hoursAgo(2) })
    .where(
      inArray(users.id, [
        userIds["alice.tech@axiom360.it"],
        userIds["coordinator@axiom360.it"],
      ]),
    );

  // Tickets + messages
  const { ticketIds, count: ticketCount } = await seedTickets(userIds);

  // Procurement
  const procCount = await seedProcurement(ticketIds, userIds);

  // Attachments
  const attCount = await seedAttachments(ticketIds);

  // Audit log
  const auditCount = await seedAuditLog(userIds, ticketIds);

  // Notifications
  const notifCount = await seedNotifications(userIds, ticketIds);

  // Holidays
  const holCount = await seedHolidays(superAdminId);

  // Failed notifications
  const failedCount = await seedFailedNotifications();

  console.log("✓ Demo seed complete.");
  console.log(
    `   ${DEMO_USERS.length} users, ${ticketCount} tickets, ${procCount} procurement, ${attCount} attachments,`,
  );
  console.log(
    `   ${auditCount} audit, ${notifCount} notifications, ${holCount} holidays, ${failedCount} failed notifications.`,
  );
  console.log("");
  console.log(`   Demo password (all users): ${DEMO_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Demo seed failed:", err);
    process.exit(1);
  });
