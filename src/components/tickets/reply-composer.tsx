"use client";

import { type FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Lock, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addInternalNote, replyToTicket } from "@/app/actions/tickets";
import {
  confirmUpload,
  generateUploadUrl,
} from "@/app/actions/attachments";
import { cn } from "@/lib/utils";
import {
  isAllowedMimeType,
  MAX_FILE_BYTES,
} from "@/lib/storage/mime";

const MAX_FILES = 5;

type ReplyComposerProps = {
  ticketId: string;
  /** Whether the current user holds tickets.internal_note for this ticket. */
  canInternalNote?: boolean;
};

type Pending = {
  /** Local id for keyed rendering before the server gives us an attachment id. */
  key: string;
  file: File;
  status: "queued" | "uploading" | "confirming" | "ready" | "failed";
  attachmentId?: string;
  error?: string;
};

export function ReplyComposer({
  ticketId,
  canInternalNote = false,
}: ReplyComposerProps) {
  const router = useRouter();
  const tReply = useTranslations("tickets.reply");
  const tActions = useTranslations("tickets.actions");
  const tAtt = useTranslations("tickets.attachments");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const internal = isInternal && canInternalNote;
  const hasUploadingFile = pendingFiles.some(
    (p) => p.status === "uploading" || p.status === "confirming",
  );
  const hasFailedFile = pendingFiles.some((p) => p.status === "failed");

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file after removal
    if (files.length === 0) return;

    const room = MAX_FILES - pendingFiles.length;
    if (files.length > room) {
      setError(tAtt("tooManyFiles", { max: MAX_FILES }));
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
          error: tAtt("rejectedType", { fileName: f.name }),
        });
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        next.push({
          key: crypto.randomUUID(),
          file: f,
          status: "failed",
          error: tAtt("tooLarge", {
            fileName: f.name,
            limitMb: Math.floor(MAX_FILE_BYTES / 1024 / 1024),
          }),
        });
        continue;
      }
      next.push({ key: crypto.randomUUID(), file: f, status: "queued" });
    }
    setPendingFiles((prev) => [...prev, ...next]);

    // Kick off uploads for the queued ones.
    for (const p of next) {
      if (p.status === "queued") void uploadOne(p.key);
    }
  }

  async function uploadOne(key: string) {
    const target = pendingFiles.find((p) => p.key === key);
    // Find the current snapshot via setState callback to avoid stale state.
    // We use a tiny "load by key from latest state" pattern.
    let current: Pending | undefined;
    setPendingFiles((prev) => {
      current = prev.find((p) => p.key === key);
      if (!current) return prev;
      return prev.map((p) =>
        p.key === key ? { ...p, status: "uploading" } : p,
      );
    });
    if (!current && !target) return;
    const file = (current ?? target)!.file;

    try {
      const presign = await generateUploadUrl({
        ticketId,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!presign.ok) {
        markFailed(key, presign.error);
        return;
      }
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        markFailed(key, `Upload failed (${put.status})`);
        return;
      }
      setPendingFiles((prev) =>
        prev.map((p) =>
          p.key === key
            ? {
                ...p,
                status: "confirming",
                attachmentId: presign.attachmentId,
              }
            : p,
        ),
      );
      const confirm = await confirmUpload({
        attachmentId: presign.attachmentId,
      });
      if (!confirm.ok) {
        markFailed(key, confirm.error);
        return;
      }
      setPendingFiles((prev) =>
        prev.map((p) => (p.key === key ? { ...p, status: "ready" } : p)),
      );
    } catch (err) {
      markFailed(key, err instanceof Error ? err.message : "Upload failed");
    }
  }

  function markFailed(key: string, message: string) {
    setPendingFiles((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, status: "failed", error: message } : p,
      ),
    );
  }

  function removePending(key: string) {
    setPendingFiles((prev) => prev.filter((p) => p.key !== key));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError(tReply("errorEmpty"));
      return;
    }
    if (hasUploadingFile) return; // disabled, but defend in depth
    const readyIds = pendingFiles
      .filter((p) => p.status === "ready" && p.attachmentId)
      .map((p) => p.attachmentId!);

    startTransition(async () => {
      try {
        if (internal) {
          await addInternalNote(ticketId, trimmed, readyIds);
        } else {
          await replyToTicket(ticketId, trimmed, readyIds);
        }
        setBody("");
        setIsInternal(false);
        setPendingFiles([]);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : internal
              ? tReply("internalErrorGeneric")
              : tReply("errorGeneric"),
        );
      }
    });
  }

  const submitDisabled =
    isSubmitting || body.trim().length === 0 || hasUploadingFile;

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "space-y-3 rounded-md p-3 transition-colors",
        internal &&
          "bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900",
      )}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder={
          internal ? tReply("internalPlaceholder") : tReply("placeholder")
        }
        maxLength={10000}
        disabled={isSubmitting}
        className={cn(
          internal &&
            "bg-amber-50/60 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800",
        )}
      />

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
                  ? tAtt("uploading", { fileName: "" }).trim().replace(":", "")
                  : p.status === "confirming"
                    ? "Verifying…"
                    : p.status === "ready"
                      ? "Ready"
                      : p.status === "failed"
                        ? p.error ?? "Failed"
                        : "Queued"}
              </span>
              <button
                type="button"
                onClick={() => removePending(p.key)}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={tAtt("remove")}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              isSubmitting || pendingFiles.length >= MAX_FILES
            }
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            <span>{tAtt("uploadButton")}</span>
            <span className="text-zinc-400">
              {pendingFiles.length}/{MAX_FILES}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handleFilePick}
          />

          {canInternalNote ? (
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="size-3.5 accent-amber-600"
                disabled={isSubmitting}
              />
              <Lock className="size-3.5" aria-hidden="true" />
              <span>{tReply("internalToggleLabel")}</span>
            </label>
          ) : null}

          <p
            className={cn(
              "text-xs",
              internal
                ? "text-amber-700 dark:text-amber-400 font-medium"
                : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {internal ? tReply("internalFooterHint") : tReply("footerHint")}
          </p>
        </div>
        <Button type="submit" disabled={submitDisabled || hasFailedFile}>
          {isSubmitting
            ? internal
              ? tReply("internalNoteSendingLabel")
              : tActions("replyPending")
            : internal
              ? tReply("internalNoteSendLabel")
              : tActions("reply")}
        </Button>
      </div>
    </form>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
