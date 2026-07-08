"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2, X } from "lucide-react";

// Point pdf.js at the LOCALLY bundled worker (pinned to the same pdfjs-dist
// version react-pdf ships). The `new URL(..., import.meta.url)` form makes the
// bundler serve the worker from our own origin — no CDN, so it works offline
// and under a strict CSP. A version skew here throws "API/worker mismatch",
// which is why pdfjs-dist is pinned as a direct dependency.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** Full-screen inline PDF preview. Dynamically imported (ssr:false) so pdfjs
 *  never runs on the server and only loads when a user actually opens a PDF.
 *  Closes via the ✕ button or Escape (keyboard-accessible; no backdrop click). */
export function PdfViewerModal({
  url,
  fileName,
  onClose,
}: {
  url: string;
  fileName: string;
  onClose: () => void;
}) {
  const t = useTranslations("tickets.attachments");
  const [numPages, setNumPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(800);

  // Close on Escape; size pages to the viewport.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onResize() {
      setWidth(Math.min(900, window.innerWidth - 32));
    }
    onResize();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
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

      <div className="flex-1 overflow-auto px-2 pb-8">
        {failed ? (
          <p className="mt-10 text-center text-sm text-white/80">
            {t("pdfPreviewFailed")}{" "}
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
          <Document
            file={url}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            onLoadError={() => setFailed(true)}
            loading={
              <div className="mt-10 flex justify-center">
                <Loader2 className="size-6 animate-spin text-white" />
              </div>
            }
            className="flex flex-col items-center gap-4"
          >
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i}
                pageNumber={i + 1}
                width={width}
                className="overflow-hidden rounded shadow-lg"
              />
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
