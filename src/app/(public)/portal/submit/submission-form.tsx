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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Red asterisk marking a required field. */
function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-red-500">
      {" *"}
    </span>
  );
}

/** Inline per-field validation message, shown directly under the input. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

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
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof typeof formData, string>>
  >({});
  const [submitting, setSubmitting] = useState(false);

  // Pre-submission draft, used so the visitor can attach a screenshot
  // before the ticket exists. Created lazily on first attach.
  const [draftTicketId, setDraftTicketId] = useState<string | null>(null);
  const [draftUploadToken, setDraftUploadToken] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Create the upload draft on demand the first time a file is picked (needs
  // name + email + captcha). The AttachmentPicker calls this from its file-pick
  // handler so the native dialog still opens on a single click.
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
    const res = await prepareGuestTicketDraft({
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
      turnstileToken,
    });
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
    // Clear this field's error the moment the user edits it.
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateForm(): Partial<Record<keyof typeof formData, string>> {
    const errs: Partial<Record<keyof typeof formData, string>> = {};
    if (!formData.customerName.trim()) {
      errs.customerName = tSubmit("validation.nameRequired");
    }
    const email = formData.customerEmail.trim();
    if (!email) {
      errs.customerEmail = tSubmit("validation.emailRequired");
    } else if (!EMAIL_RE.test(email)) {
      errs.customerEmail = tSubmit("validation.emailInvalid");
    }
    if (!formData.organization.trim()) {
      errs.organization = tSubmit("validation.organizationRequired");
    }
    if (formData.subject.trim().length < 3) {
      errs.subject = tSubmit("validation.subjectShort");
    }
    // Description is optional (CR-03/Q2) — no requirement.
    return errs;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Validate client-side first so a filled field can never trip a
    // server-side "required" error; messages render inline under each field.
    const errs = validateForm();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

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
            <Label htmlFor="customerName">
              {tFields("yourName")}
              <RequiredMark />
            </Label>
            <Input
              id="customerName"
              required
              autoComplete="name"
              value={formData.customerName}
              onChange={(e) => update("customerName", e.target.value)}
              maxLength={120}
              aria-invalid={fieldErrors.customerName ? true : undefined}
              aria-describedby={
                fieldErrors.customerName ? "customerName-error" : undefined
              }
            />
            <FieldError
              id="customerName-error"
              message={fieldErrors.customerName}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerEmail">
              {tFields("email")}
              <RequiredMark />
            </Label>
            <Input
              id="customerEmail"
              type="email"
              required
              autoComplete="email"
              value={formData.customerEmail}
              onChange={(e) => update("customerEmail", e.target.value)}
              aria-invalid={fieldErrors.customerEmail ? true : undefined}
              aria-describedby={
                fieldErrors.customerEmail ? "customerEmail-error" : undefined
              }
            />
            <FieldError
              id="customerEmail-error"
              message={fieldErrors.customerEmail}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="organization">
            {tFields("organization")}
            <RequiredMark />
          </Label>
          <Input
            id="organization"
            required
            autoComplete="organization"
            value={formData.organization}
            onChange={(e) => update("organization", e.target.value)}
            maxLength={160}
            placeholder={tFields("organizationPlaceholder")}
            aria-invalid={fieldErrors.organization ? true : undefined}
            aria-describedby={
              fieldErrors.organization
                ? "organization-error organization-hint"
                : "organization-hint"
            }
          />
          <p
            id="organization-hint"
            className="text-xs text-zinc-500 dark:text-zinc-400"
          >
            {tFields("organizationHint")}
          </p>
          <FieldError id="organization-error" message={fieldErrors.organization} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subject">
            {tFields("subject")}
            <RequiredMark />
          </Label>
          <Input
            id="subject"
            required
            value={formData.subject}
            onChange={(e) => update("subject", e.target.value)}
            maxLength={150}
            placeholder={tFields("subjectPlaceholder")}
            aria-invalid={fieldErrors.subject ? true : undefined}
            aria-describedby={fieldErrors.subject ? "subject-error" : undefined}
          />
          <FieldError id="subject-error" message={fieldErrors.subject} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">
            {tFields("description")}
            <span className="ml-1 text-xs font-normal text-zinc-500">
              {tFields("optional")}
            </span>
          </Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => update("description", e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder={tFields("descriptionPlaceholder")}
          />
          <p className="text-xs text-zinc-500 text-right">
            {formData.description.length}/5000
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>{tSubmit("attachmentsLabel")}</Label>
          <AttachmentPicker
            mode={
              draftTicketId && draftUploadToken
                ? {
                    kind: "draft",
                    ticketId: draftTicketId,
                    draftToken: draftUploadToken,
                  }
                : undefined
            }
            prepare={async () => {
              const d = await ensureDraft();
              return d
                ? { kind: "draft", ticketId: d.id, draftToken: d.token }
                : null;
            }}
            disabled={submitting}
            maxFiles={maxFiles}
            maxFileBytes={maxFileBytes}
          />
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
