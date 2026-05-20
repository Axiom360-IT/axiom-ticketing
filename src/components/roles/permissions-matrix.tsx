"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Lock } from "lucide-react";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

// Group every permission by its dotted prefix. The order here determines
// the display order of expandable sections.
const MODULE_ORDER = [
  "tickets",
  "procurement",
  "reports",
  "users",
  "roles",
  "settings",
  "audit",
] as const;
type Module = (typeof MODULE_ORDER)[number];

function groupedByModule(): Record<Module, Permission[]> {
  const out = {} as Record<Module, Permission[]>;
  for (const m of MODULE_ORDER) out[m] = [];
  for (const p of PERMISSIONS) {
    const [m] = p.split(".");
    if ((MODULE_ORDER as readonly string[]).includes(m)) {
      out[m as Module].push(p);
    }
  }
  return out;
}

type Props = {
  /** Permissions currently selected on the role being edited. */
  value: Permission[];
  /** Permissions the caller holds — anything outside this set is locked. */
  callerPermissions: Permission[];
  /** Whether the caller can effectively grant any permission (Super Admin). */
  callerHasAll: boolean;
  /** Whether to render in read-only mode (system role / no edit perm). */
  readOnly?: boolean;
  onChange: (next: Permission[]) => void;
};

export function PermissionsMatrix({
  value,
  callerPermissions,
  callerHasAll,
  readOnly = false,
  onChange,
}: Props) {
  const t = useTranslations("roles.matrix");
  // Dynamic-key lookups against the i18n bundle. next-intl complains
  // statically about unknown keys; cast to keep call sites readable.
  const tLabel = useTranslations("roles.matrix.label") as unknown as (
    key: string,
  ) => string;
  const tDesc = useTranslations("roles.matrix.description") as unknown as (
    key: string,
  ) => string;
  const tModule = useTranslations("roles.matrix.module") as unknown as (
    key: string,
  ) => string;
  const tModuleDesc = useTranslations(
    "roles.matrix.moduleDescription",
  ) as unknown as (key: string) => string;

  const groups = useMemo(() => groupedByModule(), []);
  const callerSet = useMemo(
    () => new Set(callerPermissions),
    [callerPermissions],
  );
  const valueSet = useMemo(() => new Set(value), [value]);

  const [showLockedFor, setShowLockedFor] = useState<Set<Module>>(new Set());

  function isLocked(p: Permission): boolean {
    if (readOnly) return true;
    if (callerHasAll) return false;
    return !callerSet.has(p);
  }

  function toggle(p: Permission, on: boolean) {
    if (isLocked(p)) return;
    if (on) {
      if (valueSet.has(p)) return;
      onChange([...value, p]);
    } else {
      onChange(value.filter((x) => x !== p));
    }
  }

  function toggleModule(module: Module, on: boolean) {
    const perms = groups[module].filter((p) => !isLocked(p));
    const set = new Set(value);
    if (on) {
      for (const p of perms) set.add(p);
    } else {
      for (const p of perms) set.delete(p);
    }
    onChange([...set]);
  }

  function toggleShowLocked(module: Module) {
    setShowLockedFor((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {MODULE_ORDER.map((m) => {
        const perms = groups[m];
        if (perms.length === 0) return null;

        const grantable = perms.filter((p) => !isLocked(p));
        const locked = perms.filter((p) => isLocked(p));
        const allOn =
          grantable.length > 0 && grantable.every((p) => valueSet.has(p));
        const someOn = grantable.some((p) => valueSet.has(p));
        const showingLocked = showLockedFor.has(m);
        const visiblePerms = showingLocked ? perms : grantable;
        const selectedCount = perms.filter((p) => valueSet.has(p)).length;

        return (
          // Native <details> instead of a `useState`-backed accordion.
          // Removes the whole class of state-stuck bugs (React Compiler
          // memoization, stale closures, hydration mismatches) — the
          // browser owns the open/closed bit and the chevron rotation
          // is driven by the `[open]` attribute via Tailwind's
          // open: variants. Starts expanded via the `open` prop.
          <details
            key={m}
            open
            className="group/details border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden"
          >
            <summary
              className={cn(
                "list-none cursor-pointer px-3 py-3 bg-zinc-50 dark:bg-zinc-900",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <ChevronRight
                    className="size-4 transition-transform group-open/details:rotate-90"
                    aria-hidden="true"
                  />
                  <span>{tModule(m)}</span>
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto whitespace-nowrap">
                  {t("selectedCount", {
                    selected: selectedCount,
                    total: perms.length,
                  })}
                </span>
              </div>
              <p className="mt-1 ml-5 text-xs text-zinc-500 dark:text-zinc-400">
                {tModuleDesc(m)}
              </p>
            </summary>

            {/* ── Module body (per-action checkboxes) ──────────────── */}
            {/* "Select all" toggle sits in the body, NOT the <summary>.
                Browsers route any click inside <summary> through the
                open/close machinery, which fights any interactive
                control we put there. Moving the toggle here means a
                click never bubbles to <details>, no jsx-a11y stop-
                propagation hack required. Tradeoff: the toggle is
                hidden while the section is collapsed — that's fine. */}
            {!readOnly && grantable.length > 0 ? (
              <div className="px-3 py-2 bg-zinc-50/60 dark:bg-zinc-900/60 border-b border-zinc-100 dark:border-zinc-800">
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOn && someOn;
                    }}
                    onChange={(e) => toggleModule(m, e.target.checked)}
                    className="size-3.5 accent-blue-600"
                  />
                  <span className="font-medium">{t("selectAll")}</span>
                </label>
              </div>
            ) : null}
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {visiblePerms.map((p) => {
                  const lockedNow = isLocked(p);
                  return (
                    <li
                      key={p}
                      className={cn(
                        "px-3 py-2.5",
                        lockedNow && "bg-zinc-50/40 dark:bg-zinc-900/40",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          id={`perm-${p}`}
                          type="checkbox"
                          checked={valueSet.has(p)}
                          disabled={lockedNow}
                          onChange={(e) => toggle(p, e.target.checked)}
                          className={cn(
                            "size-4 mt-0.5 accent-blue-600",
                            lockedNow && "cursor-not-allowed",
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <label
                            htmlFor={`perm-${p}`}
                            className={cn(
                              "block text-sm font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer select-none",
                              lockedNow && "cursor-not-allowed text-zinc-500",
                            )}
                          >
                            {tLabel(p.replace(/\./g, "__"))}
                          </label>
                          <p
                            className={cn(
                              "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400",
                              lockedNow && "italic",
                            )}
                          >
                            {tDesc(p.replace(/\./g, "__"))}
                          </p>
                        </div>
                        {lockedNow && !readOnly ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 shrink-0"
                            title={t("lockedTooltip")}
                          >
                            <Lock className="size-3" aria-hidden="true" />
                            {t("locked")}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {/* Locked footer — explains hidden count + toggle. */}
                {!readOnly && locked.length > 0 ? (
                  <li className="px-3 py-2 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Lock className="size-3" aria-hidden="true" />
                      {showingLocked
                        ? t("lockedTooltip")
                        : t("lockedHidden", { count: locked.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleShowLocked(m)}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {showingLocked ? t("hideLocked") : t("showLocked")}
                    </button>
                  </li>
                ) : null}
              </ul>
          </details>
        );
      })}
    </div>
  );
}
