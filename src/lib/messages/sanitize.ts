import sanitizeHtml from "sanitize-html";

// Allowlist-only HTML for message bodies. Mirrors the subset Tiptap is
// configured to produce in `RichTextEditor` — anything else (script
// tags, iframes, style attributes, event handlers) is stripped here as
// the server-side defense-in-depth layer. Even if the client-side
// editor is bypassed, what lands in the DB is bounded to this list.
//
// We also force every <a> through `rel="noopener noreferrer"` and
// `target="_blank"` and forbid any URL scheme outside `http/https/mailto`.
//
// Why not isomorphic-dompurify? It depends on jsdom for server-side
// rendering, and jsdom's transitive deps (`html-encoding-sniffer` ->
// `@exodus/bytes/encoding-lite.js`) became ESM-only in late 2025, which
// Vercel's Node 24 runtime under Next 16 / Turbopack can't `require()`
// synchronously — every server action that touched this module crashed
// with `ERR_REQUIRE_ESM`. `sanitize-html` is pure CommonJS, purpose-
// built for server-side sanitization, no DOM polyfill needed.

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
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
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  // Restrict URL schemes — drop `javascript:`, `data:`, `file:` etc.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  // Belt-and-suspenders against `target="_blank"` reverse-tabnabbing:
  // every <a> is rewritten to carry `target="_blank"` AND the proper
  // `rel`. Anything the editor produced for those two attrs is replaced.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
  },
  // Tighten parser behavior: don't try to recover from malformed HTML
  // in surprising ways, and don't emit self-closing tags for void
  // elements that don't need them.
  disallowedTagsMode: "discard",
};

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
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Strip ALL tags and return plain text. Used when we need the body's
 * length (for "is this empty?" checks) or the auto-snippet for SLA
 * dashboards. Never store the output of this — it's lossy.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .trim();
}
