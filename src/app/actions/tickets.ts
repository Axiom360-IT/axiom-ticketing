"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { checkRateLimit } from "@/lib/ratelimit";
import { getSetting } from "@/lib/settings";
import { generateTicketNumber } from "@/lib/ticket-number";
import { signGuestToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";

// ── Public ticket submission (no auth required) ──────────────────────

const TICKET_CATEGORIES = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const createTicketSchema = z.object({
  customerName: z.string().trim().min(1, "Name is required").max(120),
  customerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description must be at most 5000 characters"),
  // Anti-abuse — invisible to humans
  turnstileToken: z.string().optional(),
  honeypot: z.string().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export type CreateTicketResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

export async function createTicket(
  input: CreateTicketInput,
): Promise<CreateTicketResult> {
  // 1. Validate input shape
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  // 2. Honeypot — silently drop bots (return success-shape so they don't retry)
  if (data.honeypot && data.honeypot.length > 0) {
    return { ok: true, ticketNumber: "AX-XXXX" };
  }

  // 3. Read request metadata
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  const userAgent = h.get("user-agent") ?? undefined;

  // 4. Rate limits — IP and email
  const ipLimit = await checkRateLimit("publicSubmitByIp", `submit:ip:${ip}`);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      error: "Too many submissions from your network. Try again in an hour.",
    };
  }
  const emailLimit = await checkRateLimit(
    "publicSubmitByEmail",
    `submit:email:${data.customerEmail}`,
  );
  if (!emailLimit.allowed) {
    return {
      ok: false,
      error:
        "Too many submissions from this email today. Try again tomorrow.",
    };
  }

  // 5. Turnstile (skipped in dev without secret; required in prod)
  const turnstile = await verifyTurnstile(data.turnstileToken, ip);
  if (!turnstile.success) {
    return {
      ok: false,
      error: "Captcha verification failed. Please refresh the page and try again.",
    };
  }

  // 6. Determine stream (internal vs external) by email domain
  const internalDomains =
    (await getSetting<string[]>("internal_email_domains")) ?? [];
  const emailDomain = data.customerEmail.split("@")[1]?.toLowerCase() ?? "";
  const stream = internalDomains
    .map((d) => d.toLowerCase())
    .includes(emailDomain)
    ? "internal"
    : "external";

  // 7. Generate ticket number
  const ticketNumber = await generateTicketNumber();

  // 8. Insert ticket + initial message in a transaction
  await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        subject: data.subject,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: "open",
        stream,
        origin: "web_form",
        customerEmail: data.customerEmail,
        customerName: data.customerName,
      })
      .returning({ id: tickets.id });

    // Initial message capturing the description (so it shows up in the thread)
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorEmail: data.customerEmail,
      authorName: data.customerName,
      authorType: "customer",
      body: data.description,
      channel: "portal",
    });
  });

  // 9. Audit log
  await audit({
    actorId: null,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      stream,
      origin: "web_form",
    },
    ipAddress: ip,
    userAgent,
  });

  // 10. Send confirmation email (inline for now; Inngest fan-out comes later)
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticketNumber, data.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticketNumber}?token=${guestToken}`;

    await sendEmail({
      to: data.customerEmail,
      template: {
        template: "ticket_created",
        data: {
          ticketNumber,
          customerName: data.customerName,
          subject: data.subject,
          trackingUrl,
        },
      },
      ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    // Don't fail the ticket creation if email send fails — the ticket exists,
    // and the customer can use the portal. Log for follow-up.
    console.error("[createTicket] failed to send confirmation email:", err);
  }

  // 11. Emit Inngest event so async listeners (notifications, future jobs) can react
  // (Skipped here for Phase A; notification fan-out lands in M11.)

  return { ok: true, ticketNumber };
}
