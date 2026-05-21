"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { customerReply } from "@/app/actions/customer-portal";
import { AttachmentPicker } from "./attachment-picker";

type Props = {
  ticketId: string;
};

// Naive client-side "is this empty?" — strips tags and checks the
// remaining whitespace length. Server-side `sanitizeMessageHtml` +
// `htmlToPlainText` is the authoritative gate; this just stops the
// submit button being enabled for an empty editor.
function isHtmlEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

export function CustomerReplyComposer({ ticketId }: Props) {
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
    const result = await customerReply(ticketId, body, attachmentIds);
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
        htmlFor="reply-body"
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
          mode={{ kind: "authed", ticketId }}
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
