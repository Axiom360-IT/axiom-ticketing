"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";

/** Full-screen inline video preview — same modal shell as PdfViewerModal.
 *  Closes via the ✕ button or Escape (keyboard-accessible; no backdrop
 *  click). Plain <video>, no extra library needed. */
export function VideoViewerModal({
  url,
  fileName,
  onClose,
}: {
  url: string;
  fileName: string;
  onClose: () => void;
}) {
  const t = useTranslations("tickets.attachments");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={fileName}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-white">
        <span className="truncate text-sm font-medium">{fileName}</span>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline underline-offset-2 hover:text-white/80"
          >
            {t("openNewTab")}
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closePreview")}
            className="rounded p-1 hover:bg-white/10"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto px-4 pb-8">
        {failed ? (
          <p className="text-center text-sm text-white/80">
            {t("videoPreviewFailed")}{" "}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {t("openInNewTab")}
            </a>
          </p>
        ) : (
          <div className="relative w-full max-w-3xl">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-6 animate-spin text-white" />
              </div>
            ) : null}
            {/* User-uploaded ticket attachments never carry caption tracks. */}
            <video
              src={url}
              controls
              autoPlay={false}
              className="max-h-[80vh] w-full rounded shadow-lg"
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
