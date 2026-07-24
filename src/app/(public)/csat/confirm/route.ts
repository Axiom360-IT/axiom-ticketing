import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { signCsatAccessToken, verifyCsatToken } from "@/lib/tokens";

// Legacy one-click CSAT links (from resolution emails sent before the emoji
// upgrade) point here with a rating-bound token. We verify it, then hand off to
// the hosted `/csat` feedback page with the rating preselected and a fresh
// access token — so old links get the same comment-capable experience as new
// ones instead of silently mutating on a GET (which link-scanner prefetch could
// trigger). New emails link straight to `/csat`.
export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const ticketNumber = url.searchParams.get("t");
  const token = url.searchParams.get("tk");

  if (!ticketNumber || !token) {
    redirect("/csat/result?status=invalid");
  }

  const rating = verifyCsatToken(token, ticketNumber);
  if (!rating) {
    redirect("/csat/result?status=invalid");
  }

  const access = signCsatAccessToken(ticketNumber);
  redirect(
    `/csat?t=${encodeURIComponent(ticketNumber)}&tk=${encodeURIComponent(access)}&r=${rating}`,
  );
}
