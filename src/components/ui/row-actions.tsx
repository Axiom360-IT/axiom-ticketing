"use client";

import * as React from "react";
import { Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Sticky-right column wrappers ──────────────────────────────────
// Header + cell that pin to the right edge of a horizontally scrollable
// table. Backdrop hides scrolled-under content; subtle left-edge shadow
// gives a scroll affordance.

const STICKY_CLASS =
  "sticky right-0 z-10 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)] dark:shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.4)]";

export function StickyActionsHead({
  className,
  children,
  ...props
}: React.ComponentProps<"th">) {
  return (
    <TableHead
      scope="col"
      className={cn(STICKY_CLASS, "pr-4 text-right", className)}
      {...props}
    >
      {children}
    </TableHead>
  );
}

export function StickyActionsCell({
  className,
  children,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn(STICKY_CLASS, "pr-4 text-right", className)}
      {...props}
    >
      {children}
    </TableCell>
  );
}

// ── Three-icon row actions ────────────────────────────────────────
// Direct View / Edit / Remove icon buttons (no kebab). Pass `undefined`
// to any slot to hide the corresponding icon — caller is responsible
// for permission gating. The `remove` slot supports three variants so
// the icon and label match the action: hard delete (Trash), user
// deactivation (Trash with deactivate label), and reactivation
// (RotateCcw, swaps in for inactive users).

type RemoveVariant = "delete" | "deactivate" | "reactivate";

type RemoveAction = {
  onClick: () => void;
  variant?: RemoveVariant;
  disabled?: boolean;
};

type Props = {
  /** Used to compose the per-icon aria-label, e.g. "View AX-0042" */
  ariaLabelPrefix: string;
  view?: () => void;
  edit?: () => void;
  remove?: RemoveAction;
};

export function RowActionIcons({ ariaLabelPrefix, view, edit, remove }: Props) {
  const t = useTranslations("common");
  if (!view && !edit && !remove) return null;

  const removeLabel =
    remove?.variant === "deactivate"
      ? t("deactivate")
      : remove?.variant === "reactivate"
        ? t("reactivate")
        : t("delete");

  const RemoveIcon = remove?.variant === "reactivate" ? RotateCcw : Trash2;
  const isDestructive = remove?.variant !== "reactivate";

  return (
    <div className="inline-flex items-center gap-1">
      {view ? (
        <IconButton
          onClick={view}
          label={`${t("view")} ${ariaLabelPrefix}`}
          tone="neutral"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      ) : null}
      {edit ? (
        <IconButton
          onClick={edit}
          label={`${t("edit")} ${ariaLabelPrefix}`}
          tone="neutral"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      ) : null}
      {remove ? (
        <IconButton
          onClick={remove.onClick}
          disabled={remove.disabled}
          label={`${removeLabel} ${ariaLabelPrefix}`}
          tone={isDestructive ? "destructive" : "positive"}
        >
          <RemoveIcon className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  label,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  tone: "neutral" | "destructive" | "positive";
  disabled?: boolean;
}) {
  const toneClass =
    tone === "destructive"
      ? "text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
      : tone === "positive"
        ? "text-zinc-500 hover:bg-green-50 hover:text-green-600 dark:text-zinc-400 dark:hover:bg-green-950 dark:hover:text-green-400"
        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:pointer-events-none",
        toneClass,
      )}
    >
      {children}
    </button>
  );
}
