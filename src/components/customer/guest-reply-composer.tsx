"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { guestReply } from "@/app/actions/customer-portal";
import { AttachmentPicker } from "./attachment-picker";

type Props = {
  ticketId: string;
  ticketNumber: string;
  /** Signed token from the URL — passed back so the server can re-verify
   * on every reply. We never trust client identity claims; this is just
   * the same proof the page itself was loaded with. */
  token: string;
  /** Email decoded from the verified token on the server. Passed back
   * so the same payload can authorize attachment uploads via
   * `guestGenerateUploadUrl`. */
  customerEmail: string;
};

function isHtmlEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

export function GuestReplyComposer({
  ticketId,
  ticketNumber,
  token,
  customerEmail,
}: Props) {
  const router = useRouter();
  const t = useTranslations("portal.tickets.reply");
  const tAtt = useTranslations("tickets.attachments");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isHtmlEmpty(body)) return;
    setError(null);
    setSubmitting(true);
    const result = await guestReply({
      ticketNumber,
      token,
      body,
      attachmentIds,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBody("");
    setAttachmentIds([]);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <label
        htmlFor="guest-reply-body"
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {t("label")}
      </label>
      <RichTextEditor
        value={body}
        onChange={setBody}
        placeholder={t("placeholder")}
        disabled={submitting}
        ariaLabel={t("label")}
      />

      <div>
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
          {tAtt("label")}
        </p>
        <AttachmentPicker
          mode={{
            kind: "guest",
            ticketId,
            ticketNumber,
            guestToken: token,
            customerEmail,
          }}
          disabled={submitting}
          onReadyIdsChange={setAttachmentIds}
        />
      </div>

      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-md px-3 py-2"
        >
          {error}
        </div>
      ) : null}
      <Button
        type="submit"
        disabled={submitting || isHtmlEmpty(body)}
        className="min-h-[44px]"
      >
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
