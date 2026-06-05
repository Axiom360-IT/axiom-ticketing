"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  type GlobalSearchResult,
  globalSearch,
} from "@/app/actions/search";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 200;

const EMPTY_RESULT: GlobalSearchResult = {
  query: "",
  tickets: [],
  users: [],
  procurement: [],
};

type Item =
  | { kind: "ticket"; href: string; data: GlobalSearchResult["tickets"][number] }
  | { kind: "user"; href: string; data: GlobalSearchResult["users"][number] }
  | {
      kind: "procurement";
      href: string;
      data: GlobalSearchResult["procurement"][number];
    };

function flatten(result: GlobalSearchResult): Item[] {
  const items: Item[] = [];
  for (const t of result.tickets) {
    items.push({ kind: "ticket", href: `/admin/tickets/${t.id}`, data: t });
  }
  for (const u of result.users) {
    items.push({ kind: "user", href: `/admin/users/${u.id}`, data: u });
  }
  for (const p of result.procurement) {
    items.push({
      kind: "procurement",
      href: `/admin/procurement/${p.id}`,
      data: p,
    });
  }
  return items;
}

export function GlobalSearch() {
  const router = useRouter();
  const t = useTranslations("admin.shell");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownId = useId();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult>(EMPTY_RESULT);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  // ⌘K / Ctrl+K from anywhere — focuses the input. Esc inside the
  // dropdown closes it and restores focus to the previous element.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search. Both branches schedule async work — we never
  // set state synchronously inside the effect body.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length < 2) {
        setResult({ ...EMPTY_RESULT, query });
        setActiveIndex(0);
        return;
      }
      startTransition(async () => {
        const r = await globalSearch(query);
        setResult(r);
        setActiveIndex(0);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const items = flatten(result);
  const trimmedLen = query.trim().length;
  const tooShort = trimmedLen > 0 && trimmedLen < 2;
  // Show the dropdown whenever the input is focused — gives the user
  // immediate feedback. The dropdown body branches on state below.
  const showDropdown = open;

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!showDropdown || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[activeIndex];
      if (target) {
        router.push(target.href);
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    }
  }

  return (
    <div className="relative flex-1 min-w-0 max-w-md">
      <label className="sr-only" htmlFor={`${dropdownId}-input`}>
        {t("topbarSearchAriaLabel")}
      </label>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-200 dark:focus-within:ring-blue-900">
        <Search className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${dropdownId}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={showDropdown}
          aria-controls={`${dropdownId}-list`}
          aria-busy={isPending}
          autoComplete="off"
          placeholder={t("topbarSearchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so click-on-result still registers before blur
            // collapses the dropdown.
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
        <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-zinc-500">
          ⌘K
        </kbd>
      </div>

      {showDropdown ? (
        <div
          id={`${dropdownId}-list`}
          role="listbox"
          className="absolute left-0 right-0 mt-1 max-h-96 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg z-30"
        >
          {trimmedLen === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("topbarSearchHintEmpty")}
            </p>
          ) : tooShort ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("topbarSearchHintShort")}
            </p>
          ) : isPending ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("topbarSearchLoading")}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("topbarSearchNoResults", { query })}
            </p>
          ) : (
            <ResultsList
              items={items}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              tickets={result.tickets.length}
              users={result.users.length}
              procurement={result.procurement.length}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResultsList({
  items,
  activeIndex,
  onHover,
  tickets,
  users,
  procurement,
}: {
  items: Item[];
  activeIndex: number;
  onHover: (i: number) => void;
  tickets: number;
  users: number;
  procurement: number;
}) {
  const t = useTranslations("admin.shell");
  // Group items in source order. We assume flatten() returns
  // tickets → users → procurement.
  const sections: { label: string; from: number; to: number }[] = [];
  let cursor = 0;
  if (tickets > 0) {
    sections.push({
      label: t("topbarSearchSectionTickets"),
      from: cursor,
      to: cursor + tickets,
    });
    cursor += tickets;
  }
  if (users > 0) {
    sections.push({
      label: t("topbarSearchSectionUsers"),
      from: cursor,
      to: cursor + users,
    });
    cursor += users;
  }
  if (procurement > 0) {
    sections.push({
      label: t("topbarSearchSectionProcurement"),
      from: cursor,
      to: cursor + procurement,
    });
  }

  return (
    <div>
      {sections.map((s) => (
        <section key={s.label}>
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-zinc-400">
            {s.label}
          </p>
          <ul>
            {items.slice(s.from, s.to).map((item, i) => {
              const idx = s.from + i;
              const active = idx === activeIndex;
              return (
                <li key={`${item.kind}-${item.data.id}`}>
                  <Link
                    href={item.href}
                    onMouseEnter={() => onHover(idx)}
                    className={cn(
                      "block px-3 py-2 text-sm",
                      active && "bg-zinc-50 dark:bg-zinc-900",
                    )}
                    role="option"
                    aria-selected={active}
                    // mousedown on Link beats input.onBlur, so the click registers.
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {item.kind === "ticket" ? (
                      <TicketRow data={item.data} />
                    ) : item.kind === "user" ? (
                      <UserRow data={item.data} />
                    ) : (
                      <ProcurementRow data={item.data} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TicketRow({
  data,
}: {
  data: GlobalSearchResult["tickets"][number];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {data.ticketNumber}
      </span>
      <span className="font-medium truncate flex-1 min-w-0">
        {data.subject}
      </span>
      <StatusBadge status={data.status} />
      <PriorityBadge priority={data.priority} />
      <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
        {data.customerName}
      </span>
    </div>
  );
}

function UserRow({ data }: { data: GlobalSearchResult["users"][number] }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium truncate">{data.name}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
        {data.email}
      </span>
    </div>
  );
}

function ProcurementRow({
  data,
}: {
  data: GlobalSearchResult["procurement"][number];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium truncate flex-1 min-w-0">
        {data.itemName}
      </span>
      <ProcurementStatusBadge status={data.status} />
      <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
        {data.requestedByEmail}
      </span>
    </div>
  );
}
