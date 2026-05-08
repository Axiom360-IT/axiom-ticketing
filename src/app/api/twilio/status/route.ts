import type { NextRequest } from "next/server";
import { validateRequest } from "twilio/lib/webhooks/webhooks";
import { db } from "@/lib/db/client";
import { processedWebhookEvents } from "@/lib/db/schema/webhooks";
import { twilioAuthToken } from "@/lib/sms/client";

// Twilio status callback. Twilio POSTs an x-www-form-urlencoded body
// containing MessageSid + MessageStatus on every status transition
// (queued → sent → delivered, or failed/undelivered).
//
// We do three things:
//   1. Verify x-twilio-signature so we trust the body
//   2. Dedupe via processed_webhook_events (provider=twilio,
//      event_id=`<MessageSid>:<MessageStatus>`) — the same SID fires
//      multiple times as the message progresses through statuses
//   3. Log delivery outcome. The full delivery-log table is BACKLOG;
//      for now Pino-style stdout is enough to debug an outage.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER = "twilio";

export async function POST(request: NextRequest): Promise<Response> {
  let token: string;
  try {
    token = twilioAuthToken();
  } catch (err) {
    console.error("[twilio/status] auth token missing:", err);
    return new Response("Webhook not configured", { status: 503 });
  }

  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!signature) return new Response("Missing signature", { status: 401 });

  // Twilio sends x-www-form-urlencoded; reading it as text preserves
  // the raw bytes for parsing while letting us pass parsed params to
  // validateRequest.
  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  // The URL Twilio signed against is the URL they POSTed to, including
  // proxy-rewritten host. We reconstruct it from the request.
  const url = request.nextUrl.href;

  const ok = validateRequest(token, signature, url, params);
  if (!ok) {
    console.warn("[twilio/status] signature verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const sid = String(params.MessageSid ?? "");
  const status = String(params.MessageStatus ?? "");
  if (!sid) {
    return new Response("Missing MessageSid", { status: 400 });
  }

  // Dedupe key includes the status so we can record every transition
  // exactly once (queued, sent, delivered are all distinct events).
  const eventId = `${sid}:${status || "unknown"}`;
  const inserted = await db
    .insert(processedWebhookEvents)
    .values({ provider: PROVIDER, eventId })
    .onConflictDoNothing()
    .returning({ eventId: processedWebhookEvents.eventId });

  if (inserted.length === 0) {
    return new Response("OK", { status: 200 });
  }

  // Surface failures; everything else is informational.
  if (status === "failed" || status === "undelivered") {
    console.error(
      `[twilio/status] ${status} sid=${sid} errorCode=${params.ErrorCode ?? ""}`,
    );
  } else {
    console.info(`[twilio/status] sid=${sid} status=${status}`);
  }

  return new Response("OK", { status: 200 });
}
