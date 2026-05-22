"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Minimal-surface editor: Bold / Italic / Bulleted list / Numbered list
// / Link. Output is HTML, sanitized server-side before insert. Anything
// outside this whitelist that a user pastes (headings, images, raw HTML
// nodes, scripts) is stripped by either Tiptap (because StarterKit
// doesn't load those marks) or by DOMPurify on the server (defense-in-
// depth). Toolbar tap targets are 36px on mobile.
//
// `value` / `onChange` is HTML. The component is uncontrolled internally
// (Tiptap manages its own state) but stays in sync with `value` for
// initial mount and external resets.

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** id for the implicit `aria-labelledby` association from a `<label>` */
  ariaLabel?: string;
  className?: string;
  minHeight?: number;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
  className,
  minHeight = 120,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We only want a subset — no headings, no horizontal rule, no code
        // block. Keep blockquote off too — agents don't need it for replies.
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Force https + rel=noopener on any link Tiptap renders, so even
        // a malicious paste can't proxy clicks through `javascript:`.
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
          class: "text-blue-600 dark:text-blue-400 hover:underline",
        },
      }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2.5 min-h-[var(--rt-min-h)]",
        ),
        "aria-label": ariaLabel ?? "Rich text editor",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // External resets (e.g. clearing the composer after submit) should
  // flow into the editor. Tiptap's setContent skips re-emit when called
  // with `emitUpdate: false`.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div
      className={cn(
        // `relative` is required so the absolutely-positioned empty-state
        // placeholder below anchors INSIDE this box. Without it the
        // placeholder escapes to the nearest positioned ancestor and
        // overlaps whatever is rendered near the editor.
        "relative rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}
      style={{ ["--rt-min-h" as string]: `${minHeight}px` }}
    >
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="text-sm text-zinc-900 dark:text-zinc-50"
      />
      {/* Empty-state placeholder. Tiptap has a Placeholder extension but
          this keeps the bundle smaller — we just style it via CSS. */}
      {placeholder && editor && editor.isEmpty ? (
        <div
          className="pointer-events-none absolute mt-[44px] px-3 py-2.5 text-sm text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        >
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const t = useTranslations("common.richText");
  if (!editor) return null;
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-zinc-200 dark:border-zinc-800">
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label={t("bold")}
      >
        <Bold className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label={t("italic")}
      >
        <Italic className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label={t("bulletList")}
      >
        <List className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label={t("orderedList")}
      >
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={() => insertOrToggleLink(editor, t("linkPrompt"))}
        label={t("link")}
      >
        <LinkIcon className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500",
        active &&
          "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

function insertOrToggleLink(editor: Editor, promptText: string) {
  // Toggle off if the cursor is inside an existing link.
  if (editor.isActive("link")) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const url = window.prompt(promptText, "https://");
  if (!url) return;
  // Only allow http(s) and mailto. Anything else (including
  // `javascript:`) gets silently rejected.
  if (!/^(https?|mailto):/i.test(url)) return;
  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: url })
    .run();
}
