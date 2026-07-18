"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setTicketInvoiceNumber } from "@/app/actions/tickets";

/**
 * Key in (or clear) the invoice number a ticket was billed under. Saves on
 * submit; the Save button is only enabled once the value differs from what's
 * stored. Marking it billed here reflects everywhere the BillingBadge is shown.
 */
export function InvoiceNumberControl({
  ticketId,
  current,
}: {
  ticketId: string;
  current: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.invoice");
  const [saved, setSaved] = useState(current ?? "");
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = value.trim() !== saved.trim();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      const res = await setTicketInvoiceNumber(ticketId, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(value.trim());
      setValue(value.trim());
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={60}
          disabled={pending}
          aria-label={t("label")}
          className="h-9"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending || !dirty}
        >
          {t("save")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
