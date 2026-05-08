import twilio, { type Twilio } from "twilio";

// Lazy Twilio client. Constructed on first use because in dev there's
// often no credentials set, and we don't want imports of this module
// from server actions to throw on cold start.

let cached: Twilio | null = null;

export function twilioClient(): Twilio {
  if (cached) return cached;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }
  cached = twilio(sid, token);
  return cached;
}

export function twilioFromNumber(): string {
  const v = process.env.TWILIO_FROM_NUMBER;
  if (!v) throw new Error("TWILIO_FROM_NUMBER is not set");
  return v;
}

/** Auth-token retrieved separately for webhook signature validation. */
export function twilioAuthToken(): string {
  const v = process.env.TWILIO_AUTH_TOKEN;
  if (!v) throw new Error("TWILIO_AUTH_TOKEN is not set");
  return v;
}
