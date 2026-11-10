import { after, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { processedWebhookEvents } from "@/lib/db/schema/webhooks";
import {
  normalizeResendInbound,
  type ResendInboundPayload,
} from "@/lib/email/inbound-payload";
import { verifySvixSignature } from "@/lib/email/webhook-signature";
import { checkRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/request";
import { processInboundDirect } from "@/lib/email/process-inbound-direct";

// Resend inbound webhook entry point. Configure the Resend dashboard to
// POST here. This handler:
//   1. Verifies the Svix signature against RESEND_WEBHOOK_SECRET
//   2. Records the (provider, svix-id) tuple for idempotency
//   3. Normalizes the provider payload, answers 200 straight away, and then —
//      in `after()`, once the response has gone — runs the full processing
//      (`runInboundEmail`, shared with the Inngest function) IN THIS PROCESS.
// Steps 1 and 2 must succeed before any state changes.
//
// Why processing is no longer queued through Inngest first: Inngest is metered,
// and when its allowance ran out (2026-11-08) it kept accepting events while
// running none of them, so inbound mail was received and logged but never
// became a ticket. Ticket creation must not depend on a queue. Inngest is now
// only the fallback (see lib/email/process-inbound-direct.ts for the exact
// rules on when a failed email is handed to it).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The work after the response (fetch the email, create the ticket, upload
// attachments to R2) can take several seconds; the platform clamps this to the
// plan's ceiling.
export const maxDuration = 60;

const PROVIDER = "resend";

export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfiguration — reject all inbound until ops sets the secret.
    console.error("[email/inbound] RESEND_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 503 });
  }

  const body = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";

  const verification = verifySvixSignature(
    body,
    { id, timestamp, signature },
    secret,
  );
  if (!verification.ok) {
    console.warn(
      `[email/inbound] signature verification failed: ${verification.reason}`,
    );
    return new Response("Unauthorized", { status: 401 });
  }

  // Flood protection — only counted after signature verification so bad
  // actors can't drain the budget with junk requests. 1000/min ceiling.
  const ip = clientIp(request.headers, "global");
  const limit = await checkRateLimit("inboundEmail", `inbound:ip:${ip}`);
  if (!limit.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limit.reset - Date.now()) / 1000),
    );
    console.warn(`[email/inbound] rate limit exceeded for ${ip}`);
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  // Idempotency: insert before processing. If the row already exists,
  // Resend retried — return 200 so they stop. We use ON CONFLICT DO
  // NOTHING and check the row count to detect the duplicate.
  const inserted = await db
    .insert(processedWebhookEvents)
    .values({ provider: PROVIDER, eventId: id })
    .onConflictDoNothing()
    .returning({ eventId: processedWebhookEvents.eventId });

  if (inserted.length === 0) {
    return new Response("Already processed", { status: 200 });
  }

  // Parse the body. If JSON is malformed but the signature was good,
  // there's nothing actionable — log loudly and 200 so Resend doesn't
  // retry forever.
  let payload: ResendInboundPayload;
  try {
    payload = JSON.parse(body) as ResendInboundPayload;
  } catch (err) {
    console.error("[email/inbound] body is not valid JSON", err);
    return new Response("Bad payload", { status: 200 });
  }

  // Resend's `email.received` webhook is metadata-only — the body, headers,
  // and attachments are NOT in this payload. We used to fetch them here
  // (GET /emails/receiving/{id}) and inline the full text/html into the
  // Inngest event — but Inngest caps event payload size (256KiB on
  // Free, 512KiB on Basic, 3MiB on Pro), and a long Outlook thread carrying
  // several inline images routinely produces bloated HTML that blows past
  // that cap. When it does, `inngest.send()` rejects the event, this handler
  // 500s ("Enqueue failed"), and the reply never gets threaded or ticketed —
  // deterministically, so Resend's redelivery retries fail identically every
  // time. Fetching the full content is now deferred to
  // `process-inbound-email` itself (inside a retried `step.run`), since a
  // plain outbound fetch from a background function has no comparable size
  // ceiling. This handler only needs enough of the raw payload to confirm
  // there's a real sender before processing.
  const normalized = normalizeResendInbound(payload);
  if (!normalized) {
    console.warn("[email/inbound] payload has no usable sender; dropping");
    return new Response("OK", { status: 200 });
  }

  // Answer first, work after. The provider only needs to know we accepted it
  // (the idempotency row above already makes a redelivery harmless), and a
  // slow fetch/upload must not make it time out and redeliver.
  after(() => processInboundDirect({ payload: normalized, eventId: id }));

  return new Response("OK", { status: 200 });
}
