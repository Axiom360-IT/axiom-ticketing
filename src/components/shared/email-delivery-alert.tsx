"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  LifeBuoy,
  Loader2,
  MailWarning,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  recheckEmailDelivery,
  sendDeliveryTestEmail,
  type TestOutcome,
} from "@/app/actions/email-delivery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "This person isn't getting our emails."
//
// Shown on a ticket and on a user's profile when Resend is refusing an address.
// The customer sees every update in the portal, so nothing looks wrong to them
// either — they simply never get the email, and until now the only way anyone
// found out was the customer mentioning it a day later.
//
// It does three jobs: say WHO and WHY in plain words, say exactly HOW to fix it
// (Resend's un-suppress API is private beta, so the fix is a button in their
// dashboard — we cannot do it for you, but we can walk you to it), and let you
// CHECK the fix worked without waiting.

export type AlertIssue = {
  email: string;
  status: "suppressed" | "bounced" | "complained";
  /** ISO. */
  since: string;
};

const RESEND_EMAILS_URL = "https://resend.com/emails";

export function EmailDeliveryAlert({
  issues,
  canAct,
  className,
}: {
  issues: AlertIssue[];
  /** May the viewer send a test and recheck? Anyone sees the warning. */
  canAct: boolean;
  className?: string;
}) {
  const t = useTranslations("emailDelivery");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, TestOutcome>>({});
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  if (issues.length === 0) return null;

  function test(email: string) {
    setError(null);
    setBusy(email);
    startTransition(async () => {
      const res = await sendDeliveryTestEmail(email);
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOutcomes((o) => ({ ...o, [email]: res.outcome }));
      // Delivered: the flag has just cleared server-side, so refresh and the
      // whole warning goes away. Anything else: refresh keeps it honest.
      router.refresh();
    });
  }

  function recheck() {
    setError(null);
    setChecked(false);
    setBusy("recheck");
    startTransition(async () => {
      const res = await recheckEmailDelivery();
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChecked(true);
      router.refresh();
    });
  }

  return (
    <section
      role="alert"
      aria-live="polite"
      className={cn(
        "rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <MailWarning
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="font-semibold">{t("title", { count: issues.length })}</h2>
            <p className="mt-0.5 text-amber-900/80 dark:text-amber-200/80">
              {t("intro")}
            </p>
          </div>

          <ul className="space-y-2">
            {issues.map((issue) => {
              const outcome = outcomes[issue.email];
              return (
                <li
                  key={issue.email}
                  className="rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-900 dark:bg-zinc-900/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-medium">{issue.email}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        {t(`status.${issue.status}`)}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {t("since", {
                          date: new Date(issue.since).toLocaleDateString(undefined, {
                            dateStyle: "medium",
                          }),
                        })}
                      </p>
                    </div>
                    {canAct ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => test(issue.email)}
                      >
                        {busy === issue.email ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="size-3.5" aria-hidden="true" />
                        )}
                        {busy === issue.email ? t("testing") : t("testButton")}
                      </Button>
                    ) : null}
                  </div>

                  {outcome ? (
                    <p
                      className={cn(
                        "mt-2 flex items-start gap-1.5 text-xs font-medium",
                        outcome === "delivered"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : outcome === "blocked"
                            ? "text-red-700 dark:text-red-400"
                            : "text-zinc-600 dark:text-zinc-300",
                      )}
                    >
                      {outcome === "delivered" ? (
                        <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      {t(`outcome.${outcome}`)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {error ? (
            <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p>
          ) : null}

          <details className="group rounded-md border border-amber-200 bg-white/50 dark:border-amber-900 dark:bg-zinc-900/30">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium">
              <LifeBuoy className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              {t("howTitle")}
            </summary>
            <div className="space-y-3 border-t border-amber-200 px-3 py-3 dark:border-amber-900">
              <ol className="list-decimal space-y-2 pl-5 marker:font-semibold">
                <li>{t("step1", { email: issues[0]?.email ?? "" })}</li>
                <li>{t("step2")}</li>
                <li>{t("step3")}</li>
                <li>{t("step4")}</li>
              </ol>
              <a
                href={RESEND_EMAILS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-amber-950"
              >
                {t("openResend")}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
          </details>

          {canAct ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={recheck}
              >
                {busy === "recheck" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                {busy === "recheck" ? t("checking") : t("recheck")}
              </Button>
              {checked ? (
                <span className="text-xs text-zinc-600 dark:text-zinc-300">{t("checked")}</span>
              ) : (
                <span className="text-xs text-zinc-500">{t("autoCheck")}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
