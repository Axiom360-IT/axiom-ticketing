"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { GripVertical, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadDashboardWidget, saveDashboardLayout } from "@/app/actions/dashboard";
import type { ChartLabels, ChartSpec } from "@/lib/dashboard/chart-spec";
import {
  addWidget,
  applyGridPositions,
  chartTypeFor,
  displayHeight,
  removeWidget,
  rowsForHeight,
  setChartType,
  setFixedHeight,
  stackOrder,
  type DashboardLayout,
} from "@/lib/dashboard/layout";
import { reachServer } from "@/lib/dashboard/requests";
import {
  allowedChartTypes,
  fitsContent,
  getWidget,
  GRID_COLS,
  type ChartType,
  type WidgetGroup,
  type WidgetId,
} from "@/lib/dashboard/widgets";
import { cn } from "@/lib/utils";
import { DashboardChart } from "./charts";

// ── The dashboard grid ────────────────────────────────────────────────────
//
// Draws the person's widgets on a 12-column grid they can rearrange. The server
// does all the data loading and passes each widget's content in as a `slot`;
// this component owns only the arrangement, so a widget's own markup (links,
// badges, translated copy) stays server-rendered.
//
// Two modes. Viewing is the plain dashboard. Editing ("Customize") adds a drag
// handle, a resize corner, a hide button and a chart-type picker to each widget
// and an "Add widget" list; nothing is saved until Save, and Cancel throws the
// changes away. The one exception is the chart-type picker in viewing mode,
// which saves straight away — it is a display preference, not a rearrangement.
//
// Panels (lists such as My Queue) are as tall as their content until someone
// resizes one: each reports its height and its grid cell is sized to match.
//
// Below the `md` breakpoint (and before the first width measurement, so the
// server-rendered page is never blank) widgets stack in one column in reading
// order. Dragging and resizing are not offered on a phone.

const ROW_HEIGHT = 40;
const MARGIN: [number, number] = [16, 16];
const STACK_BELOW = 768;
// Height of a chart in the stacked (phone) view, where no grid height exists.
const STACK_CHART_HEIGHT = 300;
// Room the title bar takes above a widget while customizing (Tailwind `pt-8`).
const EDIT_BAR_HEIGHT = 32;

export type DashboardSlot = {
  id: WidgetId;
  title: string;
  subtitle?: string;
  /** Nothing to show right now (e.g. SLA deadlines on a clean day). Hidden when
   *  viewing so the grid closes the gap; shown as a placeholder when editing. */
  empty?: boolean;
} & (
  | { kind: "node"; node: ReactNode }
  /** `spec: null` = an on-demand widget whose data was not loaded with the page
   *  (it is not on this person's dashboard yet); the grid fetches it when added. */
  | { kind: "chart"; spec: ChartSpec | null }
);

export type CatalogEntry = { id: WidgetId; title: string; group: WidgetGroup };

type Props = {
  initialLayout: DashboardLayout;
  /** What "Reset to default" returns to. */
  defaultLayout: DashboardLayout;
  slots: DashboardSlot[];
  /** Every widget this person may have (shown or not) — feeds "Add widget". */
  catalog: CatalogEntry[];
  chartLabels: ChartLabels;
};

export function DashboardGrid({
  initialLayout,
  defaultLayout,
  slots,
  catalog,
  chartLabels,
}: Props) {
  const t = useTranslations("admin.landing.customize");
  const { width, containerRef, mounted } = useContainerWidth();

  const [saved, setSaved] = useState(initialLayout);
  const [draft, setDraft] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // On-demand widgets fetched since the page loaded (added while customizing).
  const [fetched, setFetched] = useState<
    Partial<Record<WidgetId, { subtitle?: string; spec: ChartSpec } | "error">>
  >({});
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<WidgetId>>(new Set());
  // Pixel height of each content-fitting widget's content, as last measured.
  const [contentHeights, setContentHeights] = useState<Partial<Record<WidgetId, number>>>({});
  const reportHeight = useCallback((id: WidgetId, px: number) => {
    setContentHeights((h) => (h[id] === px ? h : { ...h, [id]: px }));
  }, []);

  const layout = editing ? draft : saved;
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const canGrid = mounted && width >= STACK_BELOW;

  // Widgets drawn right now. Empty ones are skipped when viewing so they leave
  // no hole; when editing they stay so they can still be moved or hidden.
  const shown = layout.items.filter((i) => {
    const slot = slotById.get(i.id);
    return !!slot && (editing || !slot.empty);
  });

  const hidden = catalog.filter((c) => !draft.items.some((i) => i.id === c.id));

  // ── actions ────────────────────────────────────────────────────────────

  function persist(next: DashboardLayout, onSaved: () => void, onFailed?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await reachServer(() => saveDashboardLayout(next));
      if (res.ok) {
        onSaved();
        return;
      }
      onFailed?.();
      setError(
        res.reason === "invalid"
          ? t("saveInvalid")
          : res.reason === "offline"
            ? t("saveOffline")
            : t("saveUnavailable"),
      );
    });
  }

  function startEditing() {
    setDraft(saved);
    setError(null);
    setAdding(false);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(saved);
    setError(null);
    setAdding(false);
    setEditing(false);
  }

  function saveEditing() {
    persist(draft, () => {
      setSaved(draft);
      setAdding(false);
      setEditing(false);
    });
  }

  function onGridChange(next: Layout) {
    if (!editing) return;
    setDraft((d) => applyGridPositions(d, next));
  }

  function changeChart(id: WidgetId, type: ChartType) {
    if (editing) {
      setDraft((d) => setChartType(d, id, type));
      return;
    }
    // Viewing: a display preference — show it now, save it straight away, and
    // put the old choice back if the save fails.
    const previous = saved;
    const next = setChartType(saved, id, type);
    setSaved(next);
    persist(next, () => {}, () => setSaved(previous));
  }

  async function ensureLoaded(id: WidgetId) {
    const slot = slotById.get(id);
    if (!slot || slot.kind !== "chart" || slot.spec || loadingIds.has(id)) return;
    const have = fetched[id];
    if (have && have !== "error") return;
    setLoadingIds((s) => new Set(s).add(id));
    const res = await reachServer(() => loadDashboardWidget(id));
    setFetched((f) => ({
      ...f,
      [id]: res.ok ? { subtitle: res.subtitle, spec: res.spec } : "error",
    }));
    setLoadingIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  // ── pieces ─────────────────────────────────────────────────────────────

  function renderBody(id: WidgetId, stacked: boolean) {
    const slot = slotById.get(id)!;
    const def = getWidget(id)!;
    const item = layout.items.find((i) => i.id === id);

    if (slot.empty) {
      return (
        <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-zinc-300 px-3 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("emptyWidget", { title: slot.title })}
        </div>
      );
    }

    if (slot.kind === "chart") {
      const type = chartTypeFor(def, item) ?? "bar";
      const got = fetched[id];
      const loaded = slot.spec ?? (got && got !== "error" ? got.spec : null);
      const subtitle = slot.subtitle ?? (got && got !== "error" ? got.subtitle : undefined);
      return (
        <Card className="h-full">
          <CardHeader>
            {/* In a narrow widget the picker drops under the title rather than
                squeezing it into a one-word column that pushes the chart out. */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="min-w-0 grow basis-40 space-y-1">
                <CardTitle className="line-clamp-2 text-base">{slot.title}</CardTitle>
                {subtitle ? (
                  <CardDescription
                    title={subtitle}
                    className="line-clamp-2 @max-[13rem]/card-header:hidden"
                  >
                    {subtitle}
                  </CardDescription>
                ) : null}
              </div>
              {!editing && loaded ? (
                <ChartTypeSelect
                  id={id}
                  title={slot.title}
                  value={type}
                  onChange={(v) => changeChart(id, v)}
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent
            className="min-h-0 flex-1 overflow-y-auto"
            style={
              stacked
                ? // a health ring and its table take the height they need
                  { height: def.chart?.kind === "tickets" && type === "ring" ? "auto" : STACK_CHART_HEIGHT, flex: "none" }
                : undefined
            }
          >
            {loaded ? (
              <DashboardChart spec={loaded} type={type} labels={chartLabels} title={slot.title} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                {loadingIds.has(id) ? (
                  <p role="status">{t("loadingWidget")}</p>
                ) : (
                  <>
                    <p>{t("widgetFailed")}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setFetched((f) => ({ ...f, [id]: undefined }));
                        void ensureLoaded(id);
                      }}
                      // While customizing, widget bodies ignore the mouse (so links are not
                      // followed by accident); a retry button is the one thing that must not.
                      className="pointer-events-auto rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {t("tryAgain")}
                    </button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    // Panels and stat tiles: grow to fill the widget, scroll if the content is taller.
    return (
      <PanelBody id={id} onHeight={!stacked && fitsContent(def) ? reportHeight : undefined}>
        {slot.node}
      </PanelBody>
    );
  }

  function renderChrome(id: WidgetId) {
    const slot = slotById.get(id)!;
    const def = getWidget(id)!;
    const item = layout.items.find((i) => i.id === id);
    const offered = allowedChartTypes(def);

    // A small stat tile has no room for a full title bar (it would cover the
    // very number being arranged), so it gets just a handle and a hide button in
    // its corner.
    if (isCompact(id)) {
      return (
        <div className="absolute right-1 top-1 z-20 flex items-center rounded-md bg-zinc-900/90 text-white">
          <button
            type="button"
            aria-label={t("dragHandle", { title: slot.title })}
            className="dash-drag-handle cursor-grab touch-none rounded p-1 hover:bg-white/15 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("remove", { title: slot.title })}
            onClick={() => setDraft((d) => removeWidget(d, id))}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded p-1 hover:bg-white/15"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      );
    }
    return (
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-1 rounded-t-lg bg-zinc-900/90 px-1.5 py-1 text-xs text-white">
        <button
          type="button"
          aria-label={t("dragHandle", { title: slot.title })}
          className="dash-drag-handle cursor-grab touch-none rounded p-1 hover:bg-white/15 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate">{slot.title}</span>
        {offered.length > 0 ? (
          <ChartTypeSelect
            id={id}
            title={slot.title}
            value={chartTypeFor(def, item) ?? offered[0]}
            onChange={(v) => changeChart(id, v)}
            dark
          />
        ) : null}
        <button
          type="button"
          aria-label={t("remove", { title: slot.title })}
          onClick={() => setDraft((d) => removeWidget(d, id))}
          // Stop the grid starting a drag from the button.
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded p-1 hover:bg-white/15"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────

  const gridLayout = shown.map((i) => {
    const def = getWidget(i.id)!;
    const px = slotById.get(i.id)!.empty ? undefined : contentHeights[i.id];
    const contentRows =
      px === undefined
        ? undefined
        : rowsForHeight(px + (editing ? EDIT_BAR_HEIGHT : 0), ROW_HEIGHT, MARGIN[1]);
    const h = displayHeight(def, i, contentRows);
    return {
      i: i.id,
      x: i.x,
      y: i.y,
      w: i.w,
      h,
      minW: def.size.minW,
      // A short list may need fewer rows than the usual minimum; don't let that
      // minimum turn a change of width into a change of height.
      minH: Math.min(def.size.minH, h),
    };
  });

  return (
    <div className="space-y-3">
      <Toolbar
        editing={editing}
        pending={pending}
        canEdit={canGrid}
        adding={adding}
        hiddenCount={hidden.length}
        onStart={startEditing}
        onCancel={cancelEditing}
        onSave={saveEditing}
        onReset={() => setDraft(defaultLayout)}
        onToggleAdd={() => setAdding((a) => !a)}
      />

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {editing && adding ? (
        <AddPanel
          hidden={hidden}
          onAdd={(id) => {
            setDraft((d) => addWidget(d, getWidget(id)!));
            void ensureLoaded(id);
          }}
        />
      ) : null}

      <div ref={containerRef}>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t("emptyDashboard")}
          </p>
        ) : canGrid ? (
          <ReactGridLayout
            width={width}
            layout={gridLayout}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: MARGIN, containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: ".dash-drag-handle", cancel: "select, option" }}
            resizeConfig={{ enabled: editing }}
            onLayoutChange={onGridChange}
            onResizeStop={(_all, before, after) => {
              // Changing the height is the person choosing it; changing only the
              // width leaves a panel following its content.
              if (!before || !after || before.h === after.h) return;
              setDraft((d) => setFixedHeight(d, after.i as WidgetId, after.h));
            }}
          >
            {shown.map((i) => (
              <div key={i.id}>
                <div className="relative h-full">
                  {editing ? renderChrome(i.id) : null}
                  <div
                    className={cn(
                      "h-full",
                      editing && "pointer-events-none select-none opacity-90",
                      editing && !isCompact(i.id) && "pt-8",
                    )}
                  >
                    {renderBody(i.id, false)}
                  </div>
                </div>
              </div>
            ))}
          </ReactGridLayout>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {stackOrder({ ...layout, items: shown }).map((i) => (
              <div
                key={i.id}
                className={cn(getWidget(i.id)!.group === "stats" ? "col-span-1" : "col-span-2")}
              >
                {renderBody(i.id, true)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── small parts ───────────────────────────────────────────────────────────

/**
 * A server-rendered panel or stat tile. It stretches to fill its widget; given
 * `onHeight`, it also reports how tall its content is without that stretching.
 */
function PanelBody({
  id,
  onHeight,
  children,
}: {
  id: WidgetId;
  onHeight?: (id: WidgetId, px: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    const content = box?.firstElementChild as HTMLElement | null | undefined;
    if (!box || !content || !onHeight) return;
    const measure = () => {
      // Lift the stretch for the instant of measuring, or the answer would only
      // ever be "as tall as the widget already is" and it could never shrink.
      content.style.minHeight = "0px";
      const px = content.offsetHeight;
      content.style.minHeight = "";
      if (px > 0) onHeight(id, px);
    };
    measure();
    // The box changes when the widget's width does (text re-wraps).
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [id, onHeight, children]);

  return (
    <div ref={ref} className="h-full overflow-auto [&>*]:min-h-full">
      {children}
    </div>
  );
}

function isCompact(id: WidgetId): boolean {
  return getWidget(id)?.group === "stats";
}

function Toolbar({
  editing,
  pending,
  canEdit,
  adding,
  hiddenCount,
  onStart,
  onCancel,
  onSave,
  onReset,
  onToggleAdd,
}: {
  editing: boolean;
  pending: boolean;
  canEdit: boolean;
  adding: boolean;
  hiddenCount: number;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
  onReset: () => void;
  onToggleAdd: () => void;
}) {
  const t = useTranslations("admin.landing.customize");
  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

  if (!editing) {
    // Rearranging needs the grid, which is not offered on a phone.
    if (!canEdit) return null;
    return (
      <div className="flex justify-end">
        <button type="button" onClick={onStart} className={btn}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t("customize")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
      <p className="mr-auto text-sm text-blue-900 dark:text-blue-200">{t("hint")}</p>
      <button
        type="button"
        onClick={onToggleAdd}
        aria-expanded={adding}
        disabled={hiddenCount === 0 && !adding}
        className={btn}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("addWidget")}
        {hiddenCount > 0 ? (
          <span className="rounded-full bg-zinc-100 px-1.5 text-xs tabular-nums dark:bg-zinc-800">
            {hiddenCount}
          </span>
        ) : null}
      </button>
      <button type="button" onClick={onReset} className={btn}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {t("reset")}
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className={btn}>
        {t("cancel")}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </div>
  );
}

function AddPanel({
  hidden,
  onAdd,
}: {
  hidden: CatalogEntry[];
  onAdd: (id: WidgetId) => void;
}) {
  const t = useTranslations("admin.landing.customize");
  if (hidden.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {t("addWidgetNone")}
      </p>
    );
  }
  const groups: WidgetGroup[] = ["stats", "charts", "panels"];
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {groups.map((g) => {
        const entries = hidden.filter((h) => h.group === g);
        if (entries.length === 0) return null;
        return (
          <div key={g}>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t(`group.${g}`)}
            </p>
            <ul className="flex flex-wrap gap-2">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(e.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {e.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ChartTypeSelect({
  id,
  title,
  value,
  onChange,
  dark,
}: {
  id: WidgetId;
  title: string;
  value: ChartType;
  onChange: (v: ChartType) => void;
  dark?: boolean;
}) {
  const t = useTranslations("admin.landing.customize");
  const def = getWidget(id)!;
  const options = allowedChartTypes(def);
  if (options.length < 2) return null;
  return (
    <select
      aria-label={t("chartTypeFor", { title })}
      value={value}
      onChange={(e) => onChange(e.target.value as ChartType)}
      // The grid must not treat a click on the picker as the start of a drag.
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "rounded-md border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500",
        dark
          ? "pointer-events-auto border-white/30 bg-zinc-800 text-white"
          : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
      )}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {t(`chartType.${o}`)}
        </option>
      ))}
    </select>
  );
}
