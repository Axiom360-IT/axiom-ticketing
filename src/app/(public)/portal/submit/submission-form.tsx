"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTicket, prepareGuestTicketDraft } from "@/app/actions/tickets";
import { AttachmentPicker } from "@/components/customer/attachment-picker";

// Category was removed from the customer form (Meeting-2, CR-03) — customers
// don't reliably know hardware vs software. The server defaults it to "other"
// and the Coordinator triages (AI classification later). Priority is likewise
// not exposed to customers; the server defaults to `medium`.

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

type SubmissionFormProps = {
  /** Pre-fill from session when the visitor is signed in.
   * The server still treats this submission as a public/web_form ticket;
   * the prefill is purely a UX convenience. */
  initialName?: string;
  initialEmail?: string;
  /** Admin-configured upload limits. Fetched server-side and passed in. */
  maxFiles: number;
  maxFileBytes: number;
};

export function SubmissionForm({
  initialName = "",
  initialEmail = "",
  maxFiles,
  maxFileBytes,
}: SubmissionFormProps) {
  const router = useRouter();
  const tFields = useTranslations("tickets.submit.fields");
  const tSubmit = useTranslations("tickets.submit");

  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [formData, setFormData] = useState({
    customerName: initialName,
    customerEmail: initialEmail,
    organization: "",
    subject: "",
    description: "",
  });
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pre-submission draft, used so the visitor can attach a screenshot
  // before the ticket exists. Created lazily on first attach.
  const [draftTicketId, setDraftTicketId] = useState<string | null>(null);
  const [draftUploadToken, setDraftUploadToken] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftPending, setDraftPending] = useState(false);

  async function ensureDraft(): Promise<
    { id: string; token: string } | null
  > {
    if (draftTicketId && draftUploadToken) {
      return { id: draftTicketId, token: draftUploadToken };
    }
    if (!formData.customerName.trim() || !formData.customerEmail.trim()) {
      setDraftError(tSubmit("draftNeedsContact"));
      return null;
    }
    if (!turnstileToken) {
      setDraftError(tSubmit("draftNeedsCaptcha"));
      return null;
    }
    setDraftError(null);
    setDraftPending(true);
    const res = await prepareGuestTicketDraft({
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
      turnstileToken,
    });
    setDraftPending(false);
    if (!res.ok) {
      setDraftError(res.error);
      // The captcha token gets consumed by the prepare call, so reset it.
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken("");
      }
      return null;
    }
    setDraftTicketId(res.draftTicketId);
    setDraftUploadToken(res.uploadToken);
    // Captcha token is now spent. Re-issue a fresh one for submit().
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      setTurnstileToken("");
    }
    return { id: res.draftTicketId, token: res.uploadToken };
  }

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => setTurnstileToken(""),
        });
      } else if (!window.turnstile) {
        setTimeout(tryRender, 250);
      }
    };
    tryRender();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof typeof formData>(
    key: K,
    value: (typeof formData)[K],
  ) {
    setFormData((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    setSubmitting(true);
    const result = await createTicket({
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
      organization: formData.organization,
      subject: formData.subject,
      // Priority intentionally omitted — server defaults to `medium`,
      // Coordinator triages on review.
      description: formData.description,
      turnstileToken: turnstileToken || undefined,
      honeypot,
      draftTicketId: draftTicketId ?? undefined,
      draftUploadToken: draftUploadToken ?? undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      // Reset Turnstile so a stale token isn't reused
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken("");
      }
      return;
    }

    router.push(`/portal/submit/success?ticket=${result.ticketNumber}`);
  }

  return (
    <>
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          async
          defer
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Honeypot (hidden from humans, filled by bots) */}
        <div className="hidden" aria-hidden="true">
          <label>
            {tSubmit("honeypotLabel")}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="customerName">{tFields("yourName")}</Label>
            <Input
              id="customerName"
              required
              autoComplete="name"
              value={formData.customerName}
              onChange={(e) => update("customerName", e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerEmail">{tFields("email")}</Label>
            <Input
              id="customerEmail"
              type="email"
              required
              autoComplete="email"
              value={formData.customerEmail}
              onChange={(e) => update("customerEmail", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="organization">{tFields("organization")}</Label>
          <Input
            id="organization"
            required
            autoComplete="organization"
            value={formData.organization}
            onChange={(e) => update("organization", e.target.value)}
            maxLength={160}
            placeholder={tFields("organizationPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subject">{tFields("subject")}</Label>
          <Input
            id="subject"
            required
            value={formData.subject}
            onChange={(e) => update("subject", e.target.value)}
            maxLength={150}
            placeholder={tFields("subjectPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{tFields("description")}</Label>
          <Textarea
            id="description"
            required
            value={formData.description}
            onChange={(e) => update("description", e.target.value)}
            minLength={20}
            maxLength={5000}
            rows={6}
            placeholder={tFields("descriptionPlaceholder")}
          />
          <p className="text-xs text-zinc-500">
            {formData.description.length}/5000
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>{tSubmit("attachmentsLabel")}</Label>
          {draftTicketId && draftUploadToken ? (
            <AttachmentPicker
              mode={{
                kind: "draft",
                ticketId: draftTicketId,
                draftToken: draftUploadToken,
              }}
              disabled={submitting}
              maxFiles={maxFiles}
              maxFileBytes={maxFileBytes}
            />
          ) : (
            <button
              type="button"
              onClick={() => void ensureDraft()}
              disabled={draftPending || submitting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
            >
              {draftPending
                ? tSubmit("draftPreparing")
                : tSubmit("attachmentsAddButton")}
            </button>
          )}
          {draftError ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {draftError}
            </p>
          ) : null}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tSubmit("attachmentsHint")}
          </p>
        </div>

        {/* Turnstile widget */}
        {TURNSTILE_SITE_KEY ? (
          <div ref={turnstileRef} className="flex justify-center" />
        ) : (
          <p className="text-xs text-zinc-500 italic">
            {tSubmit("captchaSkipped")}
          </p>
        )}

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? tSubmit("submitting") : tSubmit("submitButton")}
          </Button>
        </div>
      </form>
    </>
  );
}
