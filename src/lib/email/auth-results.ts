import { emailDomain } from "@/lib/email/email-domain";

// Sender authentication for inbound email (req 5.2 anti-spoofing).
//
// The ticket-authorization decision is derived from the RFC5322 From: address,
// which is trivially forgeable. Before auto-posting a reply we require evidence
// that the From: domain actually authorized the message — a DMARC-aligned pass,
// or (for senders with no DMARC record) an SPF/DKIM pass aligned to the From:
// domain. The provider (Resend) performs these checks and reports the verdict
// in the Authentication-Results header, which we parse here.
//
// Verdicts: 'pass' (authenticated + aligned), 'fail' (a check explicitly
// failed), 'none' (no usable verdict — header absent or only neutral results).
// Callers treat anything other than 'pass' as untrusted (hold for moderation).

export type AuthVerdict = "pass" | "fail" | "none";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function senderAuthVerdict(
  headers: Record<string, string>,
  fromEmail: string,
): AuthVerdict {
  const ar = (headers["authentication-results"] ?? "").toLowerCase();
  if (!ar) return "none";
  const fromDomain = emailDomain(fromEmail);
  if (!fromDomain) return "fail";
  const d = escapeRe(fromDomain);

  // DMARC is the strongest signal — a pass already implies an aligned SPF or
  // DKIM pass for the From: domain.
  if (/\bdmarc=pass\b/.test(ar)) return "pass";
  if (/\bdmarc=fail\b/.test(ar)) return "fail";

  // No DMARC verdict — accept an SPF or DKIM pass that is ALIGNED to the From:
  // domain (relaxed alignment: equal domain or a subdomain).
  const dkimAligned = new RegExp(
    `dkim=pass[^;]*header\\.(d|i)=@?[^;\\s]*${d}\\b`,
  ).test(ar);
  if (dkimAligned) return "pass";
  const spfAligned = new RegExp(
    `spf=pass[^;]*(smtp\\.mailfrom|envelope-from)=[^;\\s]*${d}\\b`,
  ).test(ar);
  if (spfAligned) return "pass";

  // A verdict was present but nothing aligned passed.
  if (/(dkim|spf|dmarc)=(fail|softfail|permerror|temperror)/.test(ar)) {
    return "fail";
  }
  return "none";
}
