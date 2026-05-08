import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { processedWebhookEvents } from "@/lib/db/schema/webhooks";
import {
  normalizeResendInbound,
  type ResendInboundPayload,
} from "@/lib/email/inbound-payload";
import { verifySvixSignature } from "@/lib/email/webhook-signature";
import { checkRateLimit } from "@/lib/ratelimit";
import { inngest } from "@/inngest/client";

// Resend inbound webhook entry point. Configure the Resend dashboard to
// POST here. We don't process the email synchronously — that work happens
// in `inngest/functions/process-inbound-email.ts`. This handler:
//   1. Verifies the Svix signature against RESEND_WEBHOOK_SECRET
//   2. Records the (provider, svix-id) tuple for idempotency
//   3. Normalizes the provider payload and emits an Inngest event
// Steps 1 and 2 must succeed before any state changes.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER = "resend";
const EVENT_NAME = "email/inbound.received";

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
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "global";
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

  const normalized = normalizeResendInbound(payload);
  if (!normalized) {
    console.warn("[email/inbound] payload has no usable sender; dropping");
    return new Response("OK", { status: 200 });
  }

  await inngest.send({
    name: EVENT_NAME,
    data: { payload: normalized, eventId: id },
  });

  return new Response("OK", { status: 200 });
}
