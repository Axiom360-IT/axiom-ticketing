"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  confirmAvatarUpload,
  removeAvatar,
  requestAvatarUpload,
} from "@/app/actions/profile";
import { initials } from "@/lib/format";

type Props = {
  name: string;
  /** Current signed avatar URL (server-generated). Null if no avatar set. */
  currentAvatarUrl: string | null;
};

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function AvatarUpload({ name, currentAvatarUrl }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.profile.avatar");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clientValidate(file: File): string | null {
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      return t("errorUnsupportedType");
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return t("errorTooLarge", { maxMb: Math.floor(MAX_AVATAR_BYTES / 1024 / 1024) });
    }
    return null;
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a failure
    if (!file) return;
    setError(null);

    const clientErr = clientValidate(file);
    if (clientErr) {
      setError(clientErr);
      return;
    }

    // Local preview while the upload runs.
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);

    startTransition(async () => {
      try {
        // 1) presign
        const presign = await requestAvatarUpload({
          mimeType: file.type,
          sizeBytes: file.size,
        });
        if (!presign.ok) {
          setError(presign.error);
          setPreviewUrl(null);
          URL.revokeObjectURL(blobUrl);
          return;
        }

        // 2) upload bytes directly to R2 — Content-Type MUST match what
        // was given to the presigner or R2 rejects the signed URL.
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

        // 3) confirm — server verifies magic bytes, updates users.image
        const confirmRes = await confirmAvatarUpload({
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
        setError(
          err instanceof Error ? err.message : t("errorUploadFailed"),
        );
        setPreviewUrl(null);
        URL.revokeObjectURL(blobUrl);
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeAvatar();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const displayedUrl = previewUrl ?? currentAvatarUrl;

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        {displayedUrl ? (
          <AvatarImage src={displayedUrl} alt={t("avatarAlt", { name })} />
        ) : null}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(",")}
          onChange={handlePick}
          disabled={pending}
          className="sr-only"
          aria-label={t("fileInputLabel")}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
        >
          <Camera className="size-4" aria-hidden="true" />
          {pending ? t("uploading") : currentAvatarUrl ? t("change") : t("upload")}
        </Button>
        {currentAvatarUrl ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleRemove}
            disabled={pending}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("remove")}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("hint", { maxMb: Math.floor(MAX_AVATAR_BYTES / 1024 / 1024) })}
          </p>
        )}
      </div>
    </div>
  );
}
