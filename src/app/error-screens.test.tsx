import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";

// Server-side rendering never runs effects, so run them inline: that is what
// lets us assert the "log the error" behaviour without a browser.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void) => {
      fn();
    },
  };
});

import AdminError from "./(admin)/admin/error";
import GlobalError from "./global-error";

const boom = Object.assign(new Error("boom"), { digest: "abc123" });

describe("error screens", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("admin error boundary shows the in-app message, a retry button, and logs the digest", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdminError error={boom} unstable_retry={() => {}} />
      </NextIntlClientProvider>,
    );

    expect(html).toContain(messages.errors.admin.title);
    expect(html).toContain(messages.errors.admin.description);
    expect(html).toContain(messages.errors.admin.tryAgain);
    expect(console.error).toHaveBeenCalledWith("[admin/error.tsx]", "abc123", boom);
  });

  it("global error screen renders its own <html> with a retry button, and now logs the digest", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={boom} unstable_retry={() => {}} />,
    );

    expect(html).toMatch(/^<html/);
    expect(html).toContain("<button");
    expect(console.error).toHaveBeenCalledWith("[global-error]", "abc123", boom);
  });

  it("global error screen logs a placeholder when there is no digest", () => {
    renderToStaticMarkup(
      <GlobalError error={new Error("client-side")} unstable_retry={() => {}} />,
    );
    expect(console.error).toHaveBeenCalledWith(
      "[global-error]",
      "(no digest)",
      expect.any(Error),
    );
  });
});
