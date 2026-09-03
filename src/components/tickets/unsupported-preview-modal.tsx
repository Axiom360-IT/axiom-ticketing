"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Download, FileText, X } from "lucide-react";

/**
 * Same full-screen modal shell as PdfViewerModal / VideoViewerModal, for a
 * file type with no in-browser renderer (Office docs, etc.) — there's no
 * general-purpose way to render .docx/.xlsx/.pptx client-side without a
 * third-party conversion service, so this opens IN THE APP (not a silent
 * new-tab fallback) and offers a clear download link instead of a blank
 * preview.
 */
export function UnsupportedPreviewModal({
  url,
  fileName,
  onClose,
}: {
  url: string;
  fileName: string;
  onClose: () => void;
}) {
  const t = useTranslations("tickets.attachments");

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
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closePreview")}
          className="rounded p-1 hover:bg-white/10"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-8 text-center">
        <FileText className="size-12 text-white/60" aria-hidden="true" />
        <p className="text-sm text-white/80">{t("previewUnavailable")}</p>
        <a
          href={url}
          download={fileName}
          className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("downloadToView")}
        </a>
      </div>
    </div>
  );
}
