"use client";

import { useEffect } from "react";

/* eslint-disable i18next/no-literal-string */
// global-error.tsx replaces the root layout when a render fault escapes
// every nested error boundary. It MUST render its own <html> and <body>
// because the regular root layout is not in scope. The next-intl provider
// is also out of scope here, so the copy is a hard-coded English fallback.

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // This screen used to log nothing, so a failure that reached it left no trace
  // in the browser console. `digest` matches the server-side log line.
  useEffect(() => {
    console.error("[global-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#52525b", marginBottom: 20 }}>
            An unexpected error interrupted this page. The team has been
            notified.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
