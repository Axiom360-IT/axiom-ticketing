"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Lock } from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";
import {
  PERMISSION_MODULES,
  type PermissionModule,
  permissionsByModule,
} from "@/lib/auth/permission-modules";
import type { UndelegableDisplay } from "@/lib/auth/rank";
import { cn } from "@/lib/utils";

// The groups, and their order, come from lib/auth/permission-modules.ts so a
// test can assert that EVERY permission lands in one. This component used to
// keep its own list of eight, which left `organizations.*` and
// `worklog.view_all` in no group at all — never rendered, so never delegable.
type Module = PermissionModule;

type Props = {
  /** Permissions currently selected on the role being edited. */
  value: Permission[];
  /** Permissions the caller holds — anything outside this set is locked. */
  callerPermissions: Permission[];
  /** Whether the caller can effectively grant any permission (Super Admin). */
  callerHasAll: boolean;
  /** Whether to render in read-only mode (system role / no edit perm). */
  readOnly?: boolean;
  /**
   * What to do with a permission the caller cannot delegate — the Technical
   * Lead's policy (`permissions.undelegable_display`):
   *   hidden  leave it out entirely: no row, and no count or "show locked"
   *           link, because either would tell the viewer it exists
   *   locked  show it greyed out, with who to ask
   */
  display: UndelegableDisplay;
  onChange: (next: Permission[]) => void;
};

export function PermissionsMatrix({
  value,
  callerPermissions,
  callerHasAll,
  readOnly = false,
  display,
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

  const groups = useMemo(() => permissionsByModule(), []);
  const callerSet = useMemo(
    () => new Set(callerPermissions),
    [callerPermissions],
  );
  const valueSet = useMemo(() => new Set(value), [value]);

  function isLocked(p: Permission): boolean {
    if (readOnly) return true;
    if (callerHasAll) return false;
    return !callerSet.has(p);
  }

  /** Does the caller hold it — i.e. could they hand it out? */
  function heldByCaller(p: Permission): boolean {
    return callerHasAll || callerSet.has(p);
  }

  // Under `hidden`, a permission the caller does not hold is not rendered, in
  // edit mode OR read-only mode. Its checkbox state still lives in `value`, so
  // saving the role resubmits it untouched rather than silently stripping it.
  function isShown(p: Permission): boolean {
    return display === "locked" || heldByCaller(p);
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

  return (
    <div className="space-y-3">
      {PERMISSION_MODULES.map((m) => {
        // Only what the policy lets this viewer see. Counts are taken over
        // THIS list, never the module's full one: "3 of 9 selected" over a
        // module that hides 4 of the 9 would announce that the 4 exist.
        const perms = groups[m].filter(isShown);
        // A module with nothing visible is not rendered at all — an empty
        // "Automation rules" section would be the same announcement.
        if (perms.length === 0) return null;

        const grantable = perms.filter((p) => !isLocked(p));
        const allOn =
          grantable.length > 0 && grantable.every((p) => valueSet.has(p));
        const someOn = grantable.some((p) => valueSet.has(p));
        const visiblePerms = perms;
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
              </ul>
          </details>
        );
      })}
    </div>
  );
}
