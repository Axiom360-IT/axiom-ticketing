import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/request";

// Edge proxy (formerly `middleware.ts` — Next.js 16 renamed the file
// convention). Two responsibilities:
//
// 1. Auth gate for /admin/* (except /admin/login) — redirect to login if no
//    session cookie is present. This is a fast pre-check; full session
//    validation happens server-side in the layout via getSessionUser().
// 2. IP-based rate limit on Better Auth's sign-in endpoints (M16). 5 attempts
//    per IP per minute. Per-account lockout (after N consecutive failures)
//    is enforced inside the sign-in Server Action, not here — the proxy
//    only sees the IP, not the email.

// Better Auth promotes its session cookie to the `__Secure-` prefix when
// the connection is HTTPS — a browser-security convention that forbids
// the cookie from being set over plain HTTP. So in production the cookie
// is `__Secure-better-auth.session_token`, while in local dev (HTTP) it
// stays `better-auth.session_token`. The proxy doesn't validate the
// value (the layout does); it only needs to know "is a session cookie
// present?" — so checking both names is enough.
function hasBetterAuthSessionCookie(req: NextRequest): boolean {
  return Boolean(
    req.cookies.get("better-auth.session_token")?.value ||
      req.cookies.get("__Secure-better-auth.session_token")?.value,
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth/sign-in")) {
    const ip = clientIp(req.headers);
    const result = await checkRateLimit("login", `signin:ip:${ip}`);
    if (!result.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((result.reset - Date.now()) / 1000),
      );
      return new NextResponse(
        JSON.stringify({
          error: "Too many sign-in attempts. Try again shortly.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }
    return NextResponse.next();
  }

  // `/admin/login` and `/admin/setup` are the two surfaces reachable
  // WITHOUT an existing session — login is the front door, setup is
  // where the setup-invite email lands so a freshly-created user can
  // pick a password BEFORE they have any way to authenticate. Gating
  // setup here would create a chicken-and-egg redirect loop.
  if (
    pathname.startsWith("/admin") &&
    !pathname.startsWith("/admin/login") &&
    !pathname.startsWith("/admin/setup")
  ) {
    if (!hasBetterAuthSessionCookie(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Customer portal authenticated routes — anonymous /portal/submit and
  // /portal/sign-in fall through unchanged.
  if (
    pathname === "/portal/tickets" ||
    pathname.startsWith("/portal/tickets/") ||
    pathname === "/portal/profile" ||
    pathname.startsWith("/portal/profile/") ||
    pathname === "/portal/sign-out"
  ) {
    if (!hasBetterAuthSessionCookie(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/portal/sign-in";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/auth/sign-in/:path*",
    "/portal/:path*",
  ],
};
