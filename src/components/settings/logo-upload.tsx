"use client";

import type React from "react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  confirmLogoUpload,
  removeLogo,
  requestLogoUpload,
} from "@/app/actions/branding";

type Props = {
  /** Current signed logo URL (server-generated), or null if none set. */
  currentLogoUrl: string | null;
};

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function LogoUpload({ currentLogoUrl }: Props) {
  const router = useRouter();
  const t = useTranslations("settings.branding.logo");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a failure
    if (!file) return;
    setError(null);

    if (
      !ALLOWED_MIME_TYPES.includes(
        file.type as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      setError(t("errorType"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(
        t("errorTooLarge", { maxMb: Math.floor(MAX_LOGO_BYTES / 1024 / 1024) }),
      );
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);

    startTransition(async () => {
      try {
        const presign = await requestLogoUpload({
          mimeType: file.type,
          sizeBytes: file.size,
        });
        if (!presign.ok) {
          setError(presign.error);
          setPreviewUrl(null);
          URL.revokeObjectURL(blobUrl);
          return;
        }
        const putRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) {
          setError(t("errorUploadFailed"));
          setPreviewUrl(null);
          URL.revokeObjectURL(blobUrl);
          return;
        }
        const confirmRes = await confirmLogoUpload({
          storageKey: presign.storageKey,
        });
        if (!confirmRes.ok) {
          setError(confirmRes.error);
          setPreviewUrl(null);
          URL.revokeObjectURL(blobUrl);
          return;
        }
        URL.revokeObjectURL(blobUrl);
        setPreviewUrl(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorUploadFailed"));
        setPreviewUrl(null);
        URL.revokeObjectURL(blobUrl);
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeLogo();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const displayedUrl = previewUrl ?? currentLogoUrl;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("title")}</p>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          {displayedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayedUrl}
              alt={t("alt")}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {t("none")}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            onChange={handlePick}
            disabled={pending}
            className="sr-only"
            aria-label={t("fileInputLabel")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
            >
              <ImageUp className="size-4" aria-hidden="true" />
              {currentLogoUrl ? t("replace") : t("upload")}
            </Button>
            {currentLogoUrl ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleRemove}
                disabled={pending}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("remove")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("hint")}</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
