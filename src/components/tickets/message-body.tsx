import { cn } from "@/lib/utils";

// Shared CSS for rendered message HTML. Mirrors the tag set produced by
// `RichTextEditor` and stripped to by `sanitizeMessageHtml` so anything
// that lands on the page already looks right.
const RENDERED_HTML_CLASSES = [
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_ul]:list-disc [&_ul]:my-2 [&_ul]:pl-5",
  "[&_ol]:list-decimal [&_ol]:my-2 [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_strong]:font-semibold [&_b]:font-semibold",
  "[&_em]:italic [&_i]:italic",
  "[&_a]:text-blue-600 [&_a]:underline [&_a]:break-words dark:[&_a]:text-blue-400",
].join(" ");

type Props = {
  body: string;
  /** 'text' = legacy/email/system messages — render as plain text with
   *  whitespace preserved. 'html' = sanitized at insert by
   *  `sanitizeMessageHtml`; safe to render directly. */
  bodyFormat: string;
  className?: string;
};

/**
 * Renders a message body honoring its stored format. HTML rows were
 * sanitized server-side at insert time — that's why this is the one
 * place in the codebase that uses `dangerouslySetInnerHTML`. The flow
 * to keep that invariant: any new write path that stores HTML MUST go
 * through `sanitizeMessageHtml` first.
 */
export function MessageBody({ body, bodyFormat, className }: Props) {
  if (bodyFormat === "html") {
    return (
      <div
        className={cn(
          "text-sm text-zinc-800 dark:text-zinc-200 break-words",
          RENDERED_HTML_CLASSES,
          className,
        )}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    );
  }
  return (
    <div
      className={cn(
        "text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words",
        className,
      )}
    >
      {body}
    </div>
  );
}
