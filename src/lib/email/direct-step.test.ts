import { describe, expect, it, vi } from "vitest";
import { createDirectStep, isSafeToReenqueue } from "./direct-step";

const fast = { sleep: async () => {}, backoffMs: () => 0 };

describe("createDirectStep", () => {
  it("returns the step's value and records it as completed", async () => {
    const { step, trace } = createDirectStep(fast);
    const out = await step.run("a", async () => 42);
    expect(out).toBe(42);
    expect(trace.completed).toEqual(["a"]);
    expect(trace.failedStep).toBeNull();
  });

  it("round-trips through JSON like Inngest does (Date becomes a string)", async () => {
    const { step } = createDirectStep(fast);
    const when = new Date("2026-11-09T14:54:09.000Z");
    const out = (await step.run("d", async () => ({ when }))) as unknown as {
      when: string;
    };
    expect(out.when).toBe("2026-11-09T14:54:09.000Z");
    expect(typeof out.when).toBe("string");
  });

  it("lets a void step return undefined", async () => {
    const { step } = createDirectStep(fast);
    await expect(step.run("v", async () => undefined)).resolves.toBeUndefined();
  });

  it("retries a failing step on its own and does not re-run finished ones", async () => {
    const { step, trace } = createDirectStep(fast);
    const first = vi.fn(async () => "one");
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "two";
    });
    await step.run("first", first);
    await expect(step.run("flaky", flaky)).resolves.toBe("two");
    expect(first).toHaveBeenCalledTimes(1);
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(trace.completed).toEqual(["first", "flaky"]);
  });

  it("gives up after the configured attempts and reports which step failed", async () => {
    const { step, trace } = createDirectStep({ ...fast, attempts: 3 });
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(step.run("insert-message", boom)).rejects.toThrow("down");
    expect(boom).toHaveBeenCalledTimes(3);
    expect(trace.failedStep).toBe("insert-message");
  });
});

describe("isSafeToReenqueue", () => {
  it("is true when only read-only steps ran and a read-only step failed", () => {
    expect(
      isSafeToReenqueue({ completed: [], failedStep: "fetch-email-content" }),
    ).toBe(true);
    expect(
      isSafeToReenqueue({
        completed: ["fetch-email-content", "resolve-by-message-refs"],
        failedStep: "load-ticket",
      }),
    ).toBe(true);
  });

  it("is false once any writing step has completed (a replay could duplicate)", () => {
    expect(
      isSafeToReenqueue({
        completed: ["fetch-email-content", "create-ticket-from-email"],
        failedStep: "ingest-new-ticket-attachments",
      }),
    ).toBe(false);
  });

  it("is false when the step that failed is itself a writer (it may have part-written)", () => {
    expect(
      isSafeToReenqueue({
        completed: ["fetch-email-content"],
        failedStep: "create-ticket-from-email",
      }),
    ).toBe(false);
  });

  it("treats an unknown step id as a writer", () => {
    expect(
      isSafeToReenqueue({ completed: ["brand-new-step"], failedStep: null }),
    ).toBe(false);
  });
});
