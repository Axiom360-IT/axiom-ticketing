"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Lock } from "lucide-react";
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

function groupedByModule(): Record<(typeof MODULE_ORDER)[number], Permission[]> {
  const out = {} as Record<(typeof MODULE_ORDER)[number], Permission[]>;
  for (const m of MODULE_ORDER) out[m] = [];
  for (const p of PERMISSIONS) {
    const [m] = p.split(".");
    if ((MODULE_ORDER as readonly string[]).includes(m)) {
      out[m as (typeof MODULE_ORDER)[number]].push(p);
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

  const groups = useMemo(() => groupedByModule(), []);
  const callerSet = useMemo(
    () => new Set(callerPermissions),
    [callerPermissions],
  );
  const valueSet = useMemo(() => new Set(value), [value]);

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const m of MODULE_ORDER) init[m] = true;
    return init;
  });

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

  function toggleModule(module: (typeof MODULE_ORDER)[number], on: boolean) {
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
      {MODULE_ORDER.map((m) => {
        const perms = groups[m];
        if (perms.length === 0) return null;
        const granular = perms.filter((p) => !isLocked(p));
        const allOn =
          granular.length > 0 && granular.every((p) => valueSet.has(p));
        const someOn = granular.some((p) => valueSet.has(p));
        const expanded = open[m];

        return (
          <div
            key={m}
            className="border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden"
          >
            <div className="flex items-center gap-3 px-3 py-2 bg-zinc-50 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [m]: !prev[m] }))
                }
                className="flex items-center gap-1.5 text-sm font-medium"
                aria-expanded={expanded}
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    !expanded && "-rotate-90",
                  )}
                  aria-hidden="true"
                />
                {t(`module.${m}`)}
              </button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto">
                {perms.filter((p) => valueSet.has(p)).length}/{perms.length}
              </span>
              {!readOnly ? (
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOn && someOn;
                    }}
                    onChange={(e) => toggleModule(m, e.target.checked)}
                    disabled={granular.length === 0}
                  />
                  <span>{t("selectAll")}</span>
                </label>
              ) : null}
            </div>
            {expanded ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {perms.map((p) => {
                  const locked = isLocked(p);
                  return (
                    <li
                      key={p}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 text-sm",
                        locked && "opacity-60",
                      )}
                    >
                      <input
                        id={`perm-${p}`}
                        type="checkbox"
                        checked={valueSet.has(p)}
                        disabled={locked}
                        onChange={(e) => toggle(p, e.target.checked)}
                        className="size-3.5"
                      />
                      <label
                        htmlFor={`perm-${p}`}
                        className={cn(
                          "flex-1 cursor-pointer select-none font-mono text-xs",
                          locked && "cursor-not-allowed",
                        )}
                      >
                        {p}
                      </label>
                      {locked && !readOnly ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-zinc-400"
                          title={t("lockedTooltip")}
                        >
                          <Lock className="size-3" aria-hidden="true" />
                          {t("locked")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
