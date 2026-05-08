import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvixSignature } from "./webhook-signature";

const SECRET_RAW = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes
const SECRET = `whsec_${SECRET_RAW}`;
const KEY = Buffer.from(SECRET_RAW, "base64");

function sign(body: string, id: string, ts: string): string {
  const sig = createHmac("sha256", KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

describe("verifySvixSignature", () => {
  const now = 1_700_000_000;

  it("accepts a fresh, well-signed request", () => {
    const body = JSON.stringify({ hello: "world" });
    const id = "msg_123";
    const ts = String(now);
    const signature = sign(body, id, ts);
    expect(
      verifySvixSignature(body, { id, timestamp: ts, signature }, SECRET, now),
    ).toEqual({ ok: true });
  });

  it("accepts a request when the secret has no `whsec_` prefix (raw form)", () => {
    const body = "{}";
    const id = "msg_1";
    const ts = String(now);
    const signature = sign(body, id, ts);
    expect(
      verifySvixSignature(body, { id, timestamp: ts, signature }, SECRET_RAW, now),
    ).toEqual({ ok: true });
  });

  it("rejects when timestamp is outside the tolerance window", () => {
    const body = "{}";
    const id = "msg_1";
    const ts = String(now - 60 * 60); // 1h old
    const signature = sign(body, id, ts);
    expect(
      verifySvixSignature(body, { id, timestamp: ts, signature }, SECRET, now),
    ).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("rejects on tampered body", () => {
    const id = "msg_1";
    const ts = String(now);
    const signature = sign("original", id, ts);
    expect(
      verifySvixSignature("modified", { id, timestamp: ts, signature }, SECRET, now),
    ).toEqual({ ok: false, reason: "no-matching-signature" });
  });

  it("rejects when headers are missing", () => {
    expect(
      verifySvixSignature("{}", { id: "", timestamp: "", signature: "" }, SECRET, now),
    ).toEqual({ ok: false, reason: "missing-headers" });
  });

  it("accepts when one of multiple v1 tokens matches", () => {
    const body = "{}";
    const id = "msg_1";
    const ts = String(now);
    const valid = sign(body, id, ts);
    const combo = `v1,bogus===== ${valid} v0,oldscheme`;
    expect(
      verifySvixSignature(body, { id, timestamp: ts, signature: combo }, SECRET, now),
    ).toEqual({ ok: true });
  });

  it("rejects when there are no v1 tokens", () => {
    expect(
      verifySvixSignature(
        "{}",
        { id: "msg_1", timestamp: String(now), signature: "v0,whatever" },
        SECRET,
        now,
      ),
    ).toEqual({ ok: false, reason: "no-matching-signature" });
  });
});
