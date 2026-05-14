"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTicket } from "@/app/actions/tickets";

const CATEGORY_OPTIONS = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;

const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;

type CategoryValue = (typeof CATEGORY_OPTIONS)[number];
type PriorityValue = (typeof PRIORITY_OPTIONS)[number];

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
};

export function SubmissionForm({
  initialName = "",
  initialEmail = "",
}: SubmissionFormProps = {}) {
  const router = useRouter();
  const tFields = useTranslations("tickets.submit.fields");
  const tSubmit = useTranslations("tickets.submit");
  const tCategory = useTranslations("tickets.category");
  const tPriorityDesc = useTranslations("tickets.categoryDescription");

  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [formData, setFormData] = useState({
    customerName: initialName,
    customerEmail: initialEmail,
    subject: "",
    category: "" as "" | CategoryValue,
    priority: "" as "" | PriorityValue,
    description: "",
  });
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    if (!formData.category || !formData.priority) {
      setError(tSubmit("chooseCategoryPriority"));
      return;
    }

    setSubmitting(true);
    const result = await createTicket({
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
      subject: formData.subject,
      category: formData.category,
      priority: formData.priority,
      description: formData.description,
      turnstileToken: turnstileToken || undefined,
      honeypot,
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

        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="category">{tFields("category")}</Label>
            <Select
              value={formData.category}
              onValueChange={(v) =>
                update("category", v as typeof formData.category)
              }
            >
              <SelectTrigger id="category">
                <SelectValue placeholder={tFields("categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tCategory(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priority">{tFields("priority")}</Label>
            <Select
              value={formData.priority}
              onValueChange={(v) =>
                update("priority", v as typeof formData.priority)
              }
            >
              <SelectTrigger id="priority">
                <SelectValue placeholder={tFields("priorityPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tPriorityDesc(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
