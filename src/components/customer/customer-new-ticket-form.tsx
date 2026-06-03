"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import {
  customerCreateTicket,
  prepareCustomerTicketDraft,
} from "@/app/actions/customer-portal";
import { AttachmentPicker } from "./attachment-picker";

// Category was removed from the customer form (Meeting-2, CR-03); the server
// defaults it to "other". The organization comes from the customer's account,
// not the form. Priority is likewise not collected — Coordinator triages on
// review and the server defaults to `medium`. See the `customerCreateSchema`
// comment in `src/app/actions/customer-portal.ts`.
//
// A draft ticket is created the first time the user picks a file (lazy
// — we don't burn a ticket number for users who never attach anything).
// Submission then promotes the draft instead of inserting fresh; the
// pre-uploaded attachments come along because they already have
// `ticket_id` set to the draft id.

type Props = {
  maxFiles: number;
  maxFileBytes: number;
};

export function CustomerNewTicketForm({ maxFiles, maxFileBytes }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.tickets.new");
  const tAtt = useTranslations("tickets.attachments");

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draftTicketId, setDraftTicketId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Create the draft ticket on demand the first time a file is picked. The
  // AttachmentPicker calls this from its file-pick handler, so the native
  // dialog still opens on a single click.
  async function ensureDraft(): Promise<string | null> {
    if (draftTicketId) return draftTicketId;
    setDraftError(null);
    const res = await prepareCustomerTicketDraft();
    if (!res.ok) {
      setDraftError(res.error);
      return null;
    }
    setDraftTicketId(res.draftTicketId);
    return res.draftTicketId;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Inline validation: subject required (≥3 chars); description optional.
    if (subject.trim().length < 3) {
      setSubjectError(t("subjectShort"));
      return;
    }
    setSubjectError(null);
    setSubmitting(true);
    const result = await customerCreateTicket({
      subject: subject.trim(),
      description: description.trim(),
      draftTicketId: draftTicketId ?? undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/portal/tickets/${result.ticketNumber}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="subject"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("subjectLabel")}
          <span aria-hidden="true" className="text-red-500">
            {" *"}
          </span>
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          minLength={3}
          maxLength={150}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            if (subjectError) setSubjectError(null);
          }}
          placeholder={t("subjectPlaceholder")}
          aria-invalid={subjectError ? true : undefined}
          aria-describedby={subjectError ? "subject-error" : undefined}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {subjectError ? (
          <p
            id="subject-error"
            role="alert"
            className="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {subjectError}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("descriptionLabel")}
          <span className="ml-1 text-xs font-normal text-zinc-500">
            {t("optional")}
          </span>
        </label>
        <textarea
          id="description"
          name="description"
          maxLength={5000}
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <p className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
          {tAtt("label")}
        </p>
        <AttachmentPicker
          mode={
            draftTicketId ? { kind: "authed", ticketId: draftTicketId } : undefined
          }
          prepare={async () => {
            const id = await ensureDraft();
            return id ? { kind: "authed", ticketId: id } : null;
          }}
          disabled={submitting}
          maxFiles={maxFiles}
          maxFileBytes={maxFileBytes}
        />
        {draftError ? (
          <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {draftError}
          </p>
        ) : null}
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

      <button
        type="submit"
        disabled={submitting}
        className="w-full sm:w-auto px-5 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
