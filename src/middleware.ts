import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware. Two responsibilities right now:
 *
 * 1. Auth gate for /admin/* (except /admin/login) — redirect to login if no
 *    session cookie is present. This is a fast pre-check; full session
 *    validation happens server-side in the layout via getSessionUser().
 * 2. Reserved for future rate limiting (M16) and security headers.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Cookie-presence check for /admin routes
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
  matcher: ["/admin/:path*"],
};
