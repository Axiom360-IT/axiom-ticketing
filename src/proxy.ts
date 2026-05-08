import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";

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

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth/sign-in")) {
    const ip = clientIp(req);
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

  if (
    pathname.startsWith("/admin") &&
    !pathname.startsWith("/admin/login")
  ) {
    const sessionToken = req.cookies.get("better-auth.session_token");
    if (!sessionToken) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/auth/sign-in/:path*"],
};
