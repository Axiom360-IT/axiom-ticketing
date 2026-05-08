import { createHmac, timingSafeEqual } from "node:crypto";

// Resend uses Svix-format webhook signatures. The signature header carries
// one or more space-separated tokens of the form `v1,<base64-sig>`. The
// payload signed is `<svix-id>.<svix-timestamp>.<raw-body>`. We verify in
// constant time and reject anything older than the tolerance window.
//
// We implement the verification ourselves rather than pulling in the `svix`
// SDK so the production runtime stays small and there's nothing to mock in
// tests — this is ~30 lines of crypto.

const TOLERANCE_SECONDS = 5 * 60; // Svix default

export type SvixHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing-headers"
        | "stale-timestamp"
        | "bad-secret-format"
        | "no-matching-signature";
    };

/**
 * Verifies a Svix-format webhook signature. `secret` is the raw secret
 * from Resend (`whsec_...`). `body` is the raw request body (string).
 */
export function verifySvixSignature(
  body: string,
  headers: SvixHeaders,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing-headers" };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale-timestamp" };
  }

  // Resend secrets are prefixed with `whsec_` and the rest is base64.
  const rawKey = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawKey, "base64");
  } catch {
    return { ok: false, reason: "bad-secret-format" };
  }
  if (key.length === 0) {
    return { ok: false, reason: "bad-secret-format" };
  }

  const signedPayload = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", key).update(signedPayload).digest();

  // The header may carry multiple `vN,<sig>` tokens — accept if any v1 matches.
  for (const token of signature.split(/\s+/)) {
    const [version, sig] = token.split(",");
    if (version !== "v1" || !sig) continue;
    let received: Buffer;
    try {
      received = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (received.length !== expected.length) continue;
    if (timingSafeEqual(received, expected)) return { ok: true };
  }

  return { ok: false, reason: "no-matching-signature" };
}
