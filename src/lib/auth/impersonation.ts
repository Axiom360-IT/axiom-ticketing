import { createHmac, timingSafeEqual } from "node:crypto";

// Signed cookie payload that records "real admin X is currently acting
// as user Y". Stored in an httpOnly cookie. Reading it always re-checks
// the signature so a tampered cookie can't promote anyone.
//
// We use HMAC-SHA256 of `<impersonatorId>|<targetId>` keyed off
// `IMPERSONATION_TOKEN_SECRET`, then base64url-encode the
// `<payload>:<sig>` string, mirroring lib/tokens.ts.

export const IMPERSONATION_COOKIE = "axiom_imp";

function getSecret(): string {
  const s = process.env.IMPERSONATION_TOKEN_SECRET;
  if (!s) throw new Error("IMPERSONATION_TOKEN_SECRET is not set");
  return s;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signImpersonationToken(
  impersonatorId: string,
  targetId: string,
): string {
  const secret = getSecret();
  const payload = `${impersonatorId}|${targetId}`;
  const sig = sign(secret, payload);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyImpersonationToken(
  token: string,
): { impersonatorId: string; targetId: string } | null {
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const colon = decoded.lastIndexOf(":");
    if (colon < 0) return null;
    const payload = decoded.slice(0, colon);
    const providedSig = decoded.slice(colon + 1);
    const expectedSig = sign(secret, payload);
    if (!safeEqual(providedSig, expectedSig)) return null;
    const [impersonatorId, targetId] = payload.split("|");
    if (!impersonatorId || !targetId) return null;
    return { impersonatorId, targetId };
  } catch {
    return null;
  }
}
