"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { Download, FileText, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

// pdfjs is heavy and browser-only — load the PDF modal on demand, never on the
// server, so it stays out of the initial bundle and off the SSR path.
const PdfViewerModal = dynamic(
  () => import("./pdf-viewer-modal").then((m) => m.PdfViewerModal),
  { ssr: false },
);

export type ViewerAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** Resolves an attachment id to a short-lived signed URL. Callers pass the
 *  variant that matches their auth (staff/customer session vs guest token). */
export type ResolveUrl = (
  attachmentId: string,
) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

function isImage(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}
function isPdf(mime: string): boolean {
  return mime.toLowerCase() === "application/pdf";
}

/**
 * Shared attachment renderer for every conversation thread (admin + portal +
 * guest). Images become thumbnails that open a zoomable lightbox; PDFs open an
 * inline preview; anything else downloads. The only thing that differs per
 * surface is how a signed URL is obtained — injected via `resolveUrl`.
 */
export function AttachmentViewer({
  items,
  resolveUrl,
}: {
  items: ViewerAttachment[];
  resolveUrl: ResolveUrl;
}) {
  const images = items.filter((a) => isImage(a.mimeType));
  const files = items.filter((a) => !isImage(a.mimeType));

  // id → resolved signed URL. Images are prefetched on mount for thumbnails;
  // files resolve lazily on click.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [pdf, setPdf] = useState<{ url: string; fileName: string } | null>(null);

  const imageIdKey = images.map((a) => a.id).join(",");

  // Prefetch signed URLs for this message's image thumbnails (a handful).
  // Cancels on unmount so a slow resolve can't setState after teardown.
  useEffect(() => {
    if (images.length === 0) return;
    let cancelled = false;
    void Promise.all(
      images.map(async (a) => {
        const res = await resolveUrl(a.id);
        return res.ok ? ([a.id, res.url] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the image id set only: `resolveUrl` is often an inline closure
    // (new each render), so depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIdKey]);

  const resolvedImages = images.filter((a) => urls[a.id]);
  const slides = resolvedImages.map((a) => ({
    src: urls[a.id],
    title: a.fileName,
    description: formatBytes(a.sizeBytes),
  }));

  async function ensureUrl(a: ViewerAttachment): Promise<string | null> {
    if (urls[a.id]) return urls[a.id];
    setPendingId(a.id);
    setError(null);
    const res = await resolveUrl(a.id);
    setPendingId(null);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setUrls((prev) => ({ ...prev, [a.id]: res.url }));
    return res.url;
  }

  async function openFile(a: ViewerAttachment) {
    const url = await ensureUrl(a);
    if (!url) return;
    if (isPdf(a.mimeType)) {
      setPdf({ url, fileName: a.fileName });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => {
            const url = urls[a.id];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  const idx = resolvedImages.findIndex((x) => x.id === a.id);
                  if (idx >= 0) setLightboxIndex(idx);
                }}
                disabled={!url}
                title={a.fileName}
                aria-label={`Open ${a.fileName}`}
                className={cn(
                  "relative flex size-24 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-xs text-zinc-500 transition-colors hover:border-blue-400 dark:border-zinc-800 dark:bg-zinc-900",
                  !url && "cursor-default",
                )}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={a.fileName}
                    className="size-full object-cover"
                  />
                ) : (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => void openFile(a)}
                disabled={pendingId === a.id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
                  pendingId === a.id && "opacity-60",
                )}
              >
                {pendingId === a.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="size-3.5" aria-hidden="true" />
                )}
                <span className="max-w-[16rem] truncate font-medium">
                  {a.fileName}
                </span>
                <span className="text-zinc-400">{formatBytes(a.sizeBytes)}</span>
                {isPdf(a.mimeType) ? (
                  <span className="rounded bg-blue-100 px-1 py-px text-[10px] font-medium uppercase text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    PDF
                  </span>
                ) : (
                  <Download
                    className="size-3.5 text-zinc-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11px] text-red-500">
          {error}
        </p>
      ) : null}

      <Lightbox
        open={lightboxIndex >= 0}
        index={Math.max(0, lightboxIndex)}
        close={() => setLightboxIndex(-1)}
        slides={slides}
        plugins={[Zoom]}
        carousel={{ finite: slides.length <= 1 }}
      />

      {pdf ? (
        <PdfViewerModal
          url={pdf.url}
          fileName={pdf.fileName}
          onClose={() => setPdf(null)}
        />
      ) : null}
    </div>
  );
}
