import { afterEach, describe, expect, it, vi } from "vitest";
import { reachServer } from "./requests";

describe("reachServer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the server's answer through, success or refusal", async () => {
    await expect(reachServer(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(reachServer(async () => ({ ok: false, reason: "invalid" }))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("turns a request that never completes into a failed result instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      reachServer(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).resolves.toEqual({ ok: false, reason: "offline" });
    expect(log).toHaveBeenCalled();
  });
});
