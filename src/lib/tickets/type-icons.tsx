import {
  AlertTriangle,
  Bell,
  Bookmark,
  Boxes,
  Building2,
  Bug,
  CircleDot,
  ClipboardList,
  CreditCard,
  FileText,
  Flag,
  Headset,
  Lock,
  Mail,
  Package,
  Phone,
  Puzzle,
  RefreshCw,
  Rocket,
  Server,
  Settings,
  Shapes,
  ShieldAlert,
  Sparkles,
  Tag,
  Truck,
  Users,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_TICKET_TYPE_ICON,
  TICKET_TYPE_ICON_KEYS,
  type TicketTypeIconKey,
} from "./type-icon-keys";

// One lucide component per key in TICKET_TYPE_ICON_KEYS — `satisfies`
// enforces the mapping is exhaustive (a key added to the keys file without a
// matching entry here fails to typecheck).
export const TICKET_TYPE_ICON_COMPONENTS = {
  tag: Tag,
  headset: Headset,
  wrench: Wrench,
  bug: Bug,
  rocket: Rocket,
  bell: Bell,
  "alert-triangle": AlertTriangle,
  "refresh-cw": RefreshCw,
  package: Package,
  "shield-alert": ShieldAlert,
  clipboard: ClipboardList,
  zap: Zap,
  settings: Settings,
  users: Users,
  mail: Mail,
  "file-text": FileText,
  building: Building2,
  "credit-card": CreditCard,
  truck: Truck,
  server: Server,
  lock: Lock,
  wifi: Wifi,
  phone: Phone,
  boxes: Boxes,
  flag: Flag,
  sparkles: Sparkles,
  puzzle: Puzzle,
  shapes: Shapes,
  bookmark: Bookmark,
  "circle-dot": CircleDot,
} satisfies Record<TicketTypeIconKey, LucideIcon>;

// Vibrant per-icon color for the sidebar's fixed-dark (`bg-slate-900`)
// surface — mirrors the "vibrant per-feature icon color" convention every
// other sidebar item already uses (see NAV_GROUPS in sidebar-content.tsx;
// the 400/500 shades read bright there). Literal strings, not
// template-composed, so Tailwind's JIT scanner picks them up.
export const TICKET_TYPE_ICON_SIDEBAR_COLOR = {
  tag: "text-sky-400",
  headset: "text-violet-400",
  wrench: "text-amber-400",
  bug: "text-red-400",
  rocket: "text-orange-400",
  bell: "text-yellow-400",
  "alert-triangle": "text-rose-400",
  "refresh-cw": "text-cyan-400",
  package: "text-emerald-400",
  "shield-alert": "text-pink-400",
  clipboard: "text-teal-400",
  zap: "text-lime-400",
  settings: "text-indigo-400",
  users: "text-blue-400",
  mail: "text-purple-400",
  "file-text": "text-fuchsia-400",
  building: "text-green-400",
  "credit-card": "text-amber-500",
  truck: "text-orange-500",
  server: "text-indigo-500",
  lock: "text-red-500",
  wifi: "text-sky-500",
  phone: "text-green-500",
  boxes: "text-violet-500",
  flag: "text-rose-500",
  sparkles: "text-yellow-500",
  puzzle: "text-purple-500",
  shapes: "text-cyan-500",
  bookmark: "text-fuchsia-500",
  "circle-dot": "text-blue-500",
} satisfies Record<TicketTypeIconKey, string>;

/** Resolves a (possibly stale/invalid) DB icon key to a KEY guaranteed to be
 *  in TICKET_TYPE_ICON_COMPONENTS, falling back to the default rather than
 *  throwing — a key can go stale if the curated vocabulary is ever trimmed.
 *
 *  Deliberately returns a key, not the component itself: a component
 *  reference produced by a function call (rather than a plain object/array
 *  index) trips the `react-hooks/static-components` lint rule when later
 *  rendered as a JSX tag. Callers should index
 *  `TICKET_TYPE_ICON_COMPONENTS[resolveTicketTypeIconKey(x)]` directly at
 *  the render site instead of binding the resolved component to a
 *  intermediate variable via this function. */
export function resolveTicketTypeIconKey(
  key: string | null | undefined,
): TicketTypeIconKey {
  if (key && (TICKET_TYPE_ICON_KEYS as readonly string[]).includes(key)) {
    return key as TicketTypeIconKey;
  }
  return DEFAULT_TICKET_TYPE_ICON;
}
