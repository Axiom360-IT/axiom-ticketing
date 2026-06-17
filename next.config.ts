import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      // `/admin/sign-in` is NOT a real route — the admin login lives at
      // `/admin/login` (only the customer portal uses `/sign-in`). People and
      // stale bookmarks hit the `/sign-in` variant out of habit; alias it so
      // they land on the real login page instead of a 404. These run before
      // the proxy, so the bad path never enters the `?from=` redirect loop.
      {
        source: "/admin/sign-in",
        destination: "/admin/login",
        permanent: false,
      },
      {
        source: "/admin/signin",
        destination: "/admin/login",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

// Per ARCHITECTURE §18: messages live at `src/messages/<locale>.json`,
// request config at `src/lib/i18n.ts`.
const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");

export default withNextIntl(nextConfig);
