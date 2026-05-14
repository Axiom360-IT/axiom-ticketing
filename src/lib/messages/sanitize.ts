import DOMPurify from "isomorphic-dompurify";

// Allowlist-only HTML for message bodies. Mirrors the subset Tiptap is
// configured to produce in `RichTextEditor` — anything else (script
// tags, iframes, style attributes, event handlers) is stripped here as
// the server-side defense-in-depth layer. Even if the client-side
// editor is bypassed, what lands in the DB is bounded to this list.
//
// We also force every <a> through `rel="noopener noreferrer"` and
// `target="_blank"` and forbid `javascript:` / `data:` URLs.

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
];

const ALLOWED_ATTR = ["href"];

const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i;

/**
 * Sanitize HTML produced by the rich-text editor before storing.
 * Returns the cleaned HTML. Always safe to render with
 * `dangerouslySetInnerHTML` afterward.
 *
 * For empty input or content that strips down to nothing, returns the
 * empty string — callers should validate non-emptiness separately if
 * required.
 */
export function sanitizeMessageHtml(html: string): string {
  if (!html) return "";
  const cleaned = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Force these attrs onto every link, regardless of what the editor
    // emitted. Belt-and-suspenders against `target="_blank"` reverse-
    // tabnabbing.
    ADD_ATTR: ["target", "rel"],
  });
  // DOMPurify doesn't apply ADD_ATTR to all tags — patch <a> manually.
  return cleaned.replace(
    /<a\s+([^>]*?)>/gi,
    (_, attrs: string) => {
      // Drop existing target/rel — we add canonical versions below.
      const stripped = attrs
        .replace(/\s*target\s*=\s*["'][^"']*["']/gi, "")
        .replace(/\s*rel\s*=\s*["'][^"']*["']/gi, "")
        .trim();
      return `<a ${stripped} target="_blank" rel="noopener noreferrer">`;
    },
  );
}

/**
 * Strip ALL tags and return plain text. Used when we need the body's
 * length (for "is this empty?" checks) or the auto-snippet for SLA
 * dashboards. Never store the output of this — it's lossy.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
    .replace(/&nbsp;/g, " ")
    .trim();
}
