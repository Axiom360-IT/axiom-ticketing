"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listActiveVendors } from "@/app/actions/vendors";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
};

/** Search-or-type vendor picker: filters the admin-managed vendor list as you
 *  type, and offers the typed text as a one-off custom vendor when it doesn't
 *  match an existing entry. Always emits a plain string — selecting from the
 *  list and typing something new are the same "value", by design (§ vendor
 *  free-text snapshot). */
export function VendorSelect({
  id,
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
}: Props) {
  const t = useTranslations("procurement.form");
  const dropdownId = useId();
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listActiveVendors().then((rows) => {
      if (!cancelled) {
        setVendors(rows);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = value.trim();
  const matches = query
    ? vendors.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
    : vendors;
  const exactMatch = vendors.some(
    (v) => v.name.toLowerCase() === query.toLowerCase(),
  );
  const showCustomOption = query.length > 0 && !exactMatch;

  function select(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={dropdownId}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion registers before blur closes it.
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />

      {open ? (
        <div
          id={dropdownId}
          role="listbox"
          className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg z-30"
        >
          {!loaded ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("vendorLoading")}
            </p>
          ) : matches.length === 0 && !showCustomOption ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("vendorNoMatches")}
            </p>
          ) : (
            <ul>
              {matches.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.name === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(v.name)}
                    className={cn(
                      "block w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
                      v.name === value && "bg-zinc-50 dark:bg-zinc-900",
                    )}
                  >
                    {v.name}
                  </button>
                </li>
              ))}
              {showCustomOption ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(query)}
                    className="block w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-zinc-50 dark:text-blue-400 dark:hover:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-900"
                  >
                    {t("vendorUseCustom", { name: query })}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
