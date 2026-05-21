"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Paperclip, X } from "lucide-react";
import {
  confirmUpload,
  generateUploadUrl,
  guestConfirmUpload,
  guestGenerateUploadUrl,
} from "@/app/actions/attachments";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MAX_FILES_PER_MESSAGE,
  isAllowedMimeType,
  MAX_FILE_BYTES,
} from "@/lib/storage/mime";

// Shared attachment picker for every customer-facing surface:
//   - mode="authed": uses session-gated `generateUploadUrl` /
//     `confirmUpload`. Caller passes `ticketId`. Used by the authed
//     customer reply composer and the authed new-ticket form (where
//     `ticketId` is the freshly-created draft ticket).
//   - mode="draft": uses token-gated `guestGenerateUploadUrl` /
//     `guestConfirmUpload`. Caller passes `ticketId` + `draftToken`.
//     Used by the anonymous new-ticket form before the user has
//     submitted, so a draft was pre-created via
//     `prepareGuestTicketDraft`.
//   - mode="guest": same actions as draft, but with `guestToken` +
//     `ticketNumber` + `customerEmail`. Used by the signed-link reply
//     composer where the ticket already exists and isn't a draft.
//
// Parent component owns the list of ready attachment ids (via the
// `onReadyIdsChange` callback) and submits them with its own action.

export type AttachmentPickerMode =
  | { kind: "authed"; ticketId: string }
  | { kind: "draft"; ticketId: string; draftToken: string }
  | {
      kind: "guest";
      ticketId: string;
      guestToken: string;
      ticketNumber: string;
      customerEmail: string;
    };

type Pending = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "confirming" | "ready" | "failed";
  attachmentId?: string;
  error?: string;
};

type Props = {
  mode: AttachmentPickerMode;
  /** Disable the picker (e.g., while the parent form is submitting). */
  disabled?: boolean;
  onReadyIdsChange?: (ids: string[]) => void;
  /** Admin-configurable: max files per message. Falls back to the
   *  default if the parent didn't fetch the setting. */
  maxFiles?: number;
  /** Admin-configurable: max bytes per file. Hard-capped at
   *  MAX_FILE_BYTES regardless. */
  maxFileBytes?: number;
};

export function AttachmentPicker({
  mode,
  disabled = false,
  onReadyIdsChange,
  maxFiles = DEFAULT_MAX_FILES_PER_MESSAGE,
  maxFileBytes = MAX_FILE_BYTES,
}: Props) {
  const t = useTranslations("tickets.attachments");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);

  function emitReadyIds(next: Pending[]) {
    onReadyIdsChange?.(
      next
        .filter((p) => p.status === "ready" && p.attachmentId)
        .map((p) => p.attachmentId!),
    );
  }

  function update(updater: (prev: Pending[]) => Pending[]) {
    setPendingFiles((prev) => {
      const next = updater(prev);
      emitReadyIds(next);
      return next;
    });
  }

  function markFailed(key: string, message: string) {
    update((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, status: "failed", error: message } : p,
      ),
    );
  }

  async function uploadOne(p: Pending) {
    update((prev) =>
      prev.map((x) => (x.key === p.key ? { ...x, status: "uploading" } : x)),
    );

    try {
      const presign =
        mode.kind === "authed"
          ? await generateUploadUrl({
              ticketId: mode.ticketId,
              fileName: p.file.name,
              mimeType: p.file.type,
              sizeBytes: p.file.size,
            })
          : await guestGenerateUploadUrl({
              ticketId: mode.ticketId,
              fileName: p.file.name,
              mimeType: p.file.type,
              sizeBytes: p.file.size,
              draftToken: mode.kind === "draft" ? mode.draftToken : undefined,
              guestToken: mode.kind === "guest" ? mode.guestToken : undefined,
              ticketNumber:
                mode.kind === "guest" ? mode.ticketNumber : undefined,
              customerEmail:
                mode.kind === "guest" ? mode.customerEmail : undefined,
            });

      if (!presign.ok) {
        markFailed(p.key, presign.error);
        return;
      }

      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": p.file.type },
        body: p.file,
      });
      if (!put.ok) {
        markFailed(p.key, `Upload failed (${put.status})`);
        return;
      }

      update((prev) =>
        prev.map((x) =>
          x.key === p.key
            ? { ...x, status: "confirming", attachmentId: presign.attachmentId }
            : x,
        ),
      );

      const confirm =
        mode.kind === "authed"
          ? await confirmUpload({ attachmentId: presign.attachmentId })
          : await guestConfirmUpload({
              attachmentId: presign.attachmentId,
              draftToken: mode.kind === "draft" ? mode.draftToken : undefined,
              guestToken: mode.kind === "guest" ? mode.guestToken : undefined,
              ticketNumber:
                mode.kind === "guest" ? mode.ticketNumber : undefined,
              customerEmail:
                mode.kind === "guest" ? mode.customerEmail : undefined,
            });

      if (!confirm.ok) {
        markFailed(p.key, confirm.error);
        return;
      }
      update((prev) =>
        prev.map((x) => (x.key === p.key ? { ...x, status: "ready" } : x)),
      );
    } catch (err) {
      markFailed(p.key, err instanceof Error ? err.message : "Upload failed");
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const room = maxFiles - pendingFiles.length;
    if (files.length > room) {
      setError(t("tooManyFiles", { max: maxFiles }));
      return;
    }
    setError(null);

    const next: Pending[] = [];
    for (const f of files) {
      if (!isAllowedMimeType(f.type)) {
        next.push({
          key: crypto.randomUUID(),
          file: f,
          status: "failed",
          error: t("rejectedType", { fileName: f.name }),
        });
        continue;
      }
      if (f.size > maxFileBytes) {
        next.push({
          key: crypto.randomUUID(),
          file: f,
          status: "failed",
          error: t("tooLarge", {
            fileName: f.name,
            limitMb: Math.floor(maxFileBytes / 1024 / 1024),
          }),
        });
        continue;
      }
      next.push({ key: crypto.randomUUID(), file: f, status: "queued" });
    }

    update((prev) => [...prev, ...next]);

    for (const p of next) {
      if (p.status === "queued") void uploadOne(p);
    }
  }

  function removePending(key: string) {
    update((prev) => prev.filter((p) => p.key !== key));
  }

  const hasUploading = pendingFiles.some(
    (p) => p.status === "uploading" || p.status === "confirming",
  );

  return (
    <div className="space-y-2">
      {pendingFiles.length > 0 ? (
        <ul className="space-y-1.5">
          {pendingFiles.map((p) => (
            <li
              key={p.key}
              className={cn(
                "flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border",
                p.status === "failed"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
              )}
            >
              <FileText className="size-3.5" aria-hidden="true" />
              <span className="font-medium truncate flex-1">{p.file.name}</span>
              <span className="text-zinc-400 shrink-0">
                {formatBytes(p.file.size)}
              </span>
              <span className="text-[10px] uppercase tracking-wide shrink-0">
                {p.status === "uploading"
                  ? t("uploadingShort")
                  : p.status === "confirming"
                    ? "Verifying…"
                    : p.status === "ready"
                      ? "Ready"
                      : p.status === "failed"
                        ? (p.error ?? "Failed")
                        : "Queued"}
              </span>
              <button
                type="button"
                onClick={() => removePending(p.key)}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t("remove")}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || hasUploading || pendingFiles.length >= maxFiles}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Paperclip className="size-3.5" aria-hidden="true" />
          <span>{t("uploadButton")}</span>
          <span className="text-zinc-400">
            {pendingFiles.length}/{maxFiles}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilePick}
        />
      </div>
    </div>
  );
}
