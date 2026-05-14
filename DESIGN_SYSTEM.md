# SynapseScope Design System — Portable Spec for Axiom360 Ticketing System

> **You are a coding agent (e.g. Claude Code) reading this file inside the `Axiom360 Ticketing System` repository. The user has handed you this file and asked you to *use this design system and implement it in this project*. Treat the rest of this document as your operating instructions. Do not skip §0.**

---

## §0 — Instructions for the AI agent

You have ONE job: bring the design system described below into this project so all UI starts looking and behaving like SynapseScope. Follow this plan in order. Stop and confirm with the user at the checkpoints marked **🛑 PAUSE**.

### Step 1 — Audit the project (before touching anything)
Run a read-only audit and report:
1. Framework + version (Next.js / Vite + React / CRA / Remix / etc.)
2. Existing styling layer(s): Tailwind? SCSS? CSS Modules? styled-components? CSS-in-JS? plain CSS?
3. Existing component library (AntD / shadcn / MUI / Mantine / Chakra / none?)
4. Existing color palette / theme tokens (read any `tailwind.config.*`, `theme.ts`, `_variables.scss`, `:root` blocks)
5. Where the global stylesheet is loaded from (`_app.tsx` / `layout.tsx` / `main.tsx` / `index.html`)
6. List of obvious places this system will land: shared `components/ui/` folder, ticket-list page, ticket-detail page, dashboard, login/auth screens

Output as a short table. **🛑 PAUSE** for the user to confirm the audit is correct before continuing.

### Step 2 — Reconcile with stack
- If Tailwind is **already present**: merge the config from §9, don't replace it wholesale.
- If Tailwind is **not present**: install Tailwind 3.4 + PostCSS + autoprefixer + `@tailwindcss/forms` + `@tailwindcss/typography`, then add the config from §9.
- If SCSS is **not present**: install `sass` and create `src/styles/`.
- If AntD is **not present**: do NOT install it. Skip §7.15 entirely and substitute plain React + Tailwind for the AntD-flavored bits in §7.7 / §7.8 / §7.12. Note this swap in your report.
- If a component library is already in place (shadcn, Mantine, etc.): keep it, but restyle its primitives to match the tokens in §2–§6. Don't introduce a second component library.

### Step 3 — Land the tokens
Create / overwrite:
- `src/styles/_variables.scss` — exactly the contents of §2.1 + §3 + §4.1
- `src/styles/globals.scss` — exactly §10 (merge any project-specific resets the user already had)
- `tailwind.config.{js,ts}` — merge §9 into existing config (preserve unrelated `content` paths and plugins)
- `postcss.config.js` — §9 footer

Wire `globals.scss` into the app entry. Verify the Roboto Google Font URL loads (do not bundle Roboto locally unless the user asks).

### Step 4 — Build atomic components
Create these under `src/components/ui/` (or wherever the project's convention dictates), with **exact** values from §7 — no approximation, no rounding:
- `Button` (variants: primary / outline-brand / outline-danger / ghost / small)
- `Badge` (success / danger / info / warning / pending / neutral)
- `Card` (soft / brand-tinted / nav-tile)
- `PageBanner` (with section breadcrumb)
- `Loader` (full-screen + inline)
- `ErrorAlert` (with optional "Report this issue" hook — wire it to whatever ticket-creation endpoint Axiom360 already has, since this IS a ticketing system)
- `Toast` (success / error / warning / info)
- `Modal` (default + warning variants)
- `Progress` (track + fill)
- `Tabs`
- `Input` / `SearchInput`
- `Table`

### Step 5 — Ticketing-specific surfaces (Axiom360-tailored)
Build these on top of the atoms — they are the bread and butter of a ticketing UI:
- **Priority badge** — map `urgent → #FF1500/#FFEBEB`, `high → #FF0E0E/#FFEBEE`, `medium → #FFC70E/#FFC70E33`, `low → #00AAE8/#0dcaf09e`. Pill shape, 12px text, 4×12 padding, 10–20px radius (match §7.2).
- **Status badge** — map `open → #007AFF/#E9EFFF`, `in-progress → #489FFF/rgba(72,159,255,0.1)`, `pending → #F54040/#FFEBEB`, `resolved → #4A9E00/#E4FFE4`, `closed → #525252/#EEEEEE`.
- **Ticket card / row** — use the soft enterprise card from §7.3 with a 4px left border colored by priority. Inside: ticket id (12px/500/`#525252`), title (16px/600/`#1A2B3C`), 1-line description (13px/`#555`), footer row with status badge + priority badge + assignee avatar + relative timestamp (12px/`#707070`).
- **Ticket detail header** — use `PageBanner` (§7.4) with the ticket title as `title`, ticket id as `subtitle`, last-updated info as `description`, and a priority/status pair as the `visual`.
- **Sidebar** — adapt §7.8 for ticketing nav groups: e.g. `My Tickets`, `Inbox`, `Assigned to me`, `Watching`, `Reports`, `Admin`. Keep the exact spacing / colors / tree connectors.
- **Top navbar** — adapt §7.7 with Axiom360 product name + a global "+ New Ticket" primary button on the right.
- **Empty states** — pattern from `empty-state` in the spec: `bg-#F6F6F6`, `radius 8`, `padding 25–20`, centered icon + 22/500 heading.

### Step 6 — Refactor 2 representative pages
Pick the two highest-traffic pages (likely `ticket list` and `ticket detail`) and rewrite them using the new components so the user can visually QA. Don't refactor everything — just enough to validate the system end-to-end.

### Step 7 — Accessibility
Add the body-class hooks from §6 and a small `AccessibilityProvider` (or extend an existing settings context) exposing toggles for reduce-motion / high-contrast / large-text.

### Hard rules — do not violate
- **Don't invent values.** If a needed value (e.g., a color for a status this spec doesn't cover) is missing, ASK the user. Don't guess.
- **Don't change behavior.** This is a styling migration. Don't refactor data flow, rename props, or "improve" components beyond what the spec requires.
- **Don't introduce a second component library.** If shadcn/Mantine/MUI is already present, restyle it; don't add AntD on top.
- **Use both blues.** `#0070C0` for nav/banner chrome, `#007AFF` for actionable elements (CTAs, focus rings, active markers). They're not interchangeable.
- **Roboto everywhere.** Never fall back to bare `system-ui`. Loaded via the Google Fonts URL in §3.1.
- **Commit per step.** One commit per step above. Small PRs > one giant PR.

When you're done with each step, write a brief status update for the user (what you did + what file paths changed) and **🛑 PAUSE** before the next step.

---

## §1 — Brand identity

| Attribute | Value |
|---|---|
| Source product | SynapseScope (skills intelligence SaaS) |
| Voice | Professional / enterprise SaaS, confident, calm |
| Density | Medium — generous padding (24–30px page padding), 8px rhythm |
| Corner style | Soft (8px utilities, 12–22px on cards/banners) |
| Surface | Mostly white with subtle blue accents; never pure-black text |
| Motion | `0.2s–0.3s ease` / `cubic-bezier(0.4, 0, 0.2, 1)`; hover lifts of `translateY(-2px)` |

---

## §2 — Color tokens

### 2.1 Primary palette (CSS variables in `_variables.scss`)

```scss
// _variables.scss
@use "sass:map";
@use "sass:list";

$brand-colors: (
  primary: #007AFF, secondary: #4b5563, accent: #2563eb,
  light: #f3f4f6, dark: #111827, uncommonColor: #EEEEEE,
);

$font-families: ( Fig: ("Figtree", sans-serif), );

$font-sizes: ( xs:0.75rem, sm:0.875rem, base:1rem, lg:1.125rem, xl:1.25rem, '2xl':1.5rem );

$spacing-scale: ( 0:0, 1:0.25rem, 2:0.5rem, 3:0.75rem, 4:1rem, 6:1.5rem, 8:2rem, 12:3rem, 16:4rem, 64:16rem );

$breakpoints: ( sm:640px, md:768px, lg:1024px, xl:1280px, '2xl':1536px );

:root {
  --color-primary:       #{map.get($brand-colors, primary)};
  --color-secondary:     #{map.get($brand-colors, secondary)};
  --color-accent:        #{map.get($brand-colors, accent)};
  --color-light:         #{map.get($brand-colors, light)};
  --color-dark:          #{map.get($brand-colors, dark)};
  --color-uncommonColor: #{map.get($brand-colors, uncommonColor)};

  --font-sans: #{list.nth(map.get($font-families, Fig), 1)};

  --text-xs:.75rem; --text-sm:.875rem; --text-base:1rem;
  --text-lg:1.125rem; --text-xl:1.25rem; --text-2xl:1.5rem;
  --text-dynamic: clamp(1rem, 0.34vw + 0.91rem, 1.19rem);

  --space-0:0; --space-1:.25rem; --space-2:.5rem; --space-3:.75rem;
  --space-4:1rem; --space-6:1.5rem; --space-8:2rem; --space-12:3rem;
  --space-16:4rem; --space-64:16rem;

  --screen-sm:640px; --screen-md:768px; --screen-lg:1024px;
  --screen-xl:1280px; --screen-2xl:1536px;

  @media (prefers-color-scheme: dark) {
    --color-primary:#3b82f6; --color-secondary:#6366f1;
  }
}
```

### 2.2 Domain blues (used as section accents)

| Token | Hex | Usage |
|---|---|---|
| `Button-01` | `#0070C0` | Navbar chrome, sidebar dropdowns, banner gradients (deeper "Microsoft" blue) |
| `primary-Buttons` | `#007AFF` | Primary CTAs, focus rings, active markers (iOS blue) |
| primary-light | `#3395ff` | hover surfaces |
| primary-dark | `#0062CC` | primary button hover/pressed |
| accent-light | `#3b82f6` | accent emphasis |
| accent-dark | `#1d4ed8` | accent pressed |

> Both blues are intentional and **not** interchangeable. `#0070C0` for navigation chrome, `#007AFF` for actionable elements.

### 2.3 Neutrals

| Token | Hex | Usage |
|---|---|---|
| `BACKGROUND` | `#F6F6F6` | Empty-state surface |
| `2nd-text` | `#525252` | Secondary text |
| `Icons` | `#707070` | Default icon color |
| Border | `#e0e0e0` | Sidebar/navbar dividers |
| Border light | `#E5E5E5` | Banner/card borders |
| Hairline | `#D0D0D0` | Sidebar tree connectors |
| Soft fill | `#E9EFFF` | Active nav item bg |
| Surface light | `#F0F8FF` | Sidebar hover |
| Subtle hover | `rgba(0, 112, 192, 0.08)` | Nav link hover |

### 2.4 Semantic

| State | Bg | Fg | Border |
|---|---|---|---|
| Success | `#E4FFE4` | `#06C906` / `#128012` | `#34D399` |
| Danger | `#FFEBEB` / `#FFEBEE` | `#FF1500` / `#C62828` | `#FFCDD2` / `#EF4444` |
| Warning | `#FFC70E33` / `#FEF3C7` | `#FFC70E` / `#D97706` | `#F59E0B` |
| Info | `#0dcaf09e` / `#D5E9FF` | `#00AAE8` / `#3B82F6` | `#3B82F6` |
| Status: completed | — | `#4A9E00` | — |
| Status: updated | — | `#489FFF` | — |
| Status: pending | — | `#F54040` | — |

### 2.5 Data-viz / pointer accents
`#FFD000`, `#FFC812`, `#4A9E00`, `#489FFF`, `#75B7FF`, `#778DA9`, `#1ADB00`, `#00d4d4`.

---

## §3 — Typography

```scss
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');

body { font-family: 'Roboto', var(--font-sans), sans-serif; }
```

Fallback chain: `Roboto, Figtree, system-ui, -apple-system, sans-serif`.

### 3.1 Size scale

| Token | rem | px | Use |
|---|---|---|---|
| `--text-xs` | 0.75 | 12 | Captions, badges |
| `--text-sm` | 0.875 | 14 | Body small, table cells |
| `--text-base` | 1 | 16 | Body |
| `--text-lg` | 1.125 | 18 | Subheadings |
| `--text-xl` | 1.25 | 20 | Section titles |
| `--text-2xl` | 1.5 | 24 | Page titles |
| `--text-dynamic` | `clamp(1rem, 0.34vw + 0.91rem, 1.19rem)` | 16–19 | Fluid body |

### 3.2 Heading utility classes

```scss
.heading   { @apply text-2xl font-bold text-primary; font-family:'Roboto',sans-serif; }
.mdheading { @apply text-lg font-bold;               font-family:'Roboto',sans-serif; }
.smheading { @apply text-base font-semibold;         font-family:'Roboto',sans-serif; }
```

### 3.3 Weight conventions
- 400 — body, table cells
- 500 — nav links, labels, sidebar items, secondary CTA text
- 600 — page titles, badge text, active sidebar groups
- 700 — banner h1

---

## §4 — Spacing & layout

### 4.1 Spacing scale
```
--space-0:0  --space-1:4px  --space-2:8px  --space-3:12px  --space-4:16px
--space-6:24px  --space-8:32px  --space-12:48px  --space-16:64px  --space-64:256px
```

### 4.2 Page chrome

| Region | Size |
|---|---|
| Navbar height | `71px` (top, fixed, `z-index:1000`) |
| Sidebar width | `240px` mobile / `280px` lg / `311px` xl |
| Sidebar offset top | `71px` |
| Content padding | `30px` desktop, `20px` ≤1024, `15px` ≤768 |
| Inner content cap | `~1200px` for forms |

### 4.3 Breakpoints
`sm:640, md:768, lg:1024, xl:1280, 2xl:1536, 3xl:1880`

---

## §5 — Radius / shadow / border

### 5.1 Border radius

| Element | Radius |
|---|---|
| Tags / pills | `10–20px` |
| Form inputs | `9px` (search) / `0.375rem` (default) |
| Buttons | `6–12px` |
| Cards | `8–22px` |
| Banner | `16px` |
| Modal | `16px` |
| Status pill | `20px` / `50px` (full pill) |

### 5.2 Shadow tokens

```css
0 1px 3px rgba(0,0,0,0.10);        /* Subtle (cards) */
0 1px 10px rgba(0,0,0,0.06);       /* Soft elevation */
0 4px 16px rgba(0,0,0,0.06);       /* Lifted card */
0 2px 16px rgba(0,0,0,0.12);       /* Hover lift */
0 2px 5.2px rgba(0,0,0,0.10);      /* Dropdown */
0 8px 24px rgba(0,0,0,0.12);       /* Notification panel */
0 4px 12px rgba(0,112,192,0.15);   /* Nav hover */
0 4px 4px rgba(0,0,0,0.25);        /* Sidebar */
0 2px 8px rgba(0,112,192,0.30);    /* Brand-tinted CTA */
```

### 5.3 Borders
- Default `1px solid #e0e0e0`
- Section `1px solid #d6e4f0` (banner)
- Input `1px solid #ced4da`
- Brand outline `1px solid #007AFF`
- Dashed brand `2px dashed #0070C0`
- Active sidebar group: `6px solid #2C51BE` left border

---

## §6 — Motion & accessibility

```
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);  /* nav links */
transition: all 0.2s ease;                           /* sidebar items */
hover transform: translateY(-2px); + scale(1.15) on icons
```

```scss
body.accessibility-high-contrast { filter: contrast(1.4) !important; }
body.accessibility-large-text    { zoom: 1.15; }
body.accessibility-reduce-motion *, *::before, *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
```

---

## §7 — Component patterns

### 7.1 Primary Button
```jsx
<button className="bg-[#007AFF] hover:bg-[#0062CC] text-white px-6 py-2 rounded-lg
                   text-sm font-medium transition-colors duration-200">
  Action
</button>
```
Variants:
- **Solid** — `bg-#007AFF` → hover `#0062CC` (or `#005a9e` for `#0070C0` chrome).
- **Outline brand** — `border border-#007AFF text-#007AFF bg-transparent` → hover fills.
- **Outline danger** — `border-#FF0E0E text-#FF0E0E` → hover fills red.
- **Ghost neutral** — `bg-#EFEFEF text-black` → hover `bg-white outline-#EFEFEF`.
- **Small CTA** — `bg-#007AFF text-white px-[22px] py-[7px] rounded-[6px] text-xs`.

### 7.2 Badge / Pill
```jsx
<span className="bg-[#E4FFE4] text-[#06C906] rounded-[10px] px-3 py-1 text-xs font-medium">
  Active
</span>
```
Map by state — see §2.4. Status pill (full round) uses `border-radius: 50px`, padding `4–5px / 12–15px`.

### 7.3 Card (three flavors)
```jsx
{/* Soft enterprise */}
<div className="bg-white rounded-2xl border border-[#d6e4f0]
                shadow-[0_1px_10px_rgba(0,0,0,0.06)] p-6
                hover:shadow-[0_2px_16px_rgba(0,0,0,0.12)] transition-shadow">

{/* Brand-tinted */}
<div className="rounded-[15px] border border-[#007AFF] bg-[rgba(0,122,255,0.1)] p-5">

{/* Highlighted nav tile */}
<div className="rounded-[22px] border border-[#007AFF] text-center cursor-pointer
                shadow-[0_1px_12.3px_rgba(0,0,0,0.08)] hover:bg-[#E9EFFF] transition">
```

### 7.4 PageBanner
```jsx
<div style={{
  background: 'linear-gradient(135deg, #ffffff 0%, #f0f7ff 50%, #e8f0fe 100%)',
  borderRadius: 16, border: '1px solid #d6e4f0', position: 'relative', overflow: 'hidden',
}} className="px-5 py-7 sm:px-10 sm:py-9">
  {/* 4px stripe */}
  <div style={{ position:'absolute', top:0, left:0, right:0, height:4,
    background:'linear-gradient(90deg, #0070C0, #4A90D9, #0070C0)' }} />
  {/* Decorative offscreen circles in rgba(0,112,192,0.03–0.04) */}
  {/* 42×42 rounded-12 brand-blue icon block + 26px/700 title + 15/500 #0070C0 subtitle + 13/normal #555 description */}
</div>
```
Section breadcrumb above banner: `11px / 600 / #0070C0 / uppercase / letter-spacing 1.2`, preceded by a 20×2 colored bar.

### 7.5 Form input
```jsx
<input className="w-full rounded-[9px] border border-[#ced4da] px-3 py-2 text-sm outline-none
                  focus:border-[#007AFF] focus:ring-2 focus:ring-[rgba(0,122,255,0.25)]
                  placeholder-[#adb5bd]" />
```
Search variant: same, plus icon at `left-3 top-1/2 -translate-y-1/2 text-[#828282]` and `pl-10`.

### 7.6 Table
```scss
.table {
  th { background:#f8f9fa; font-weight:500; color:#6c757d;
       padding:14px 25px; font-size:14–16px; }
  td { padding:15px; border-bottom:1px solid #eee;
       font-size:14px; vertical-align:middle; }
  thead, tbody tr { display:table; width:100%; table-layout:fixed; }
  tbody { display:block; overflow-y:auto; max-height:315px; }
}
```

### 7.7 Top Navbar
Fixed, 71px tall, `bg-#F5F5F5`, `border-bottom 1px #E5E5E5`, `z-index:1000`, padding `0 32px`.

```css
.nav-link-item {
  display:flex; align-items:center; padding:8px 16px; border-radius:8px;
  font-size:16px; font-weight:500; color:#646464;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.nav-link-item:not(.active):hover {
  background: rgba(0,112,192,0.08); color:#0070C0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,112,192,0.15);
}
.nav-link-item:not(.active):hover .nav-icon { transform: scale(1.15) translateY(-1px); }
.nav-link-item.active { background:#E9EFFF; color:#0070C0; font-weight:600; }
```

Active-icon SVG recolor filter:
```
brightness(0) saturate(100%) invert(27%) sepia(96%) saturate(7498%) hue-rotate(199deg) brightness(98%) contrast(101%)
```

### 7.8 Sidebar
- Fixed `left:0 top:71px height:calc(100vh-71px)`, width `240/280/311`, bg white.
- Shadow `0 4px 4px rgba(0,0,0,0.25)`.
- **Group header** (collapsible): 46px tall, `padding 12px 16px 12px 24px`, `font 16/600`, color `#2C51BE`. Active: bg `#E9EFFF`, text `#007AFF`, `border-left: 6px solid #2C51BE`.
- **Children**: `14/400`, padding `10px 20px 10px 40px`, hover bg `#E9EFFF`, active `#007AFF/600`.
- **Tree connectors**: vertical `2px #D0D0D0` lines + 8×8 dots (active `#007AFF`, idle `#D0D0D0`).
- **Collapse button**: 32×32 `bg-#007AFF` close icon top-right.
- **Reopen FAB**: `top:85px left:16px`, 40×40, white bg, border, `text-#007AFF` hamburger.

### 7.9 Loader
Full-screen `bg-white/80 backdrop-blur-sm z-50`, animated logo (`animate-pulse`), three bouncing dots `#0070C0` with delays `[-0.3s, -0.15s, 0]`.

```jsx
<div className="w-2 h-2 bg-[#0070C0] rounded-full animate-bounce [animation-delay:-0.3s]" />
```

### 7.10 ErrorAlert (with ticket creation hook)
```jsx
<div className="rounded-[8px] bg-[#FFEBEE] border border-[#FFCDD2] p-4">
  <div className="flex items-start gap-3">
    {/* AlertCircle icon, text-#C62828 */}
    <p className="text-[14px] text-[#C62828] leading-snug">{message}</p>
    {/* "Report this issue" link in #C62828 underlined; success state #2E7D32 */}
  </div>
</div>
```
**For Axiom360**: wire the "Report this issue" button to whatever existing ticket-creation API the project has — this turns errors directly into tickets.

### 7.11 Toast / Message
```scss
.custom-message {
  border-radius: var(--space-1); box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  &-success { background: rgba(52,211,153,0.1); border-left: 4px solid #34D399; }
  &-error   { background: rgba(239,68,68,0.1);  border-left: 4px solid #EF4444; }
  &-warning { background: rgba(245,158,11,0.1); border-left: 4px solid #F59E0B; }
  &-info    { background: rgba(59,130,246,0.1); border-left: 4px solid #3B82F6; }
}
```

### 7.12 Modal
- Default radius `16px`.
- Warning header bg `#FEF3C7`, title `#D97706`, border `1px #F59E0B`.
- SweetAlert2 z-index forced to `99999` to clear underlying modals at `9999`.

### 7.13 Progress
- Track: `bg-#D9D9D9` or `#F1F1F1`, `height: 17px`, `radius: 13.62–23px`.
- Fill: `bg rgba(0,122,255,0.5)` or `#75B7FF`.
- Match-progress (slim): `height 10px / radius 5 / fill #00d4d4`.

### 7.14 Tabs
```scss
.tab-list { display:flex; border-bottom:1px solid #D0D0D0; }
.tab     { padding:10px 0; margin-right:40px; font:14/500 Roboto;
           color:#333; border-bottom:2px solid transparent; cursor:pointer; }
.tab:hover  { color:#4588E0; }
.tab.active { color:#4588E0; border-bottom:2px solid #4588E0; }
```

### 7.15 AntD overrides (skip if AntD is not in the stack)
```scss
.ant-layout                  { background: white !important; }
.ant-menu-inline             { border-right: none !important; }
.ant-table-thead > tr > th   { background:#f9fafb; font-family:'Roboto'; }
.ant-pagination-item-active  { border-color:#007AFF !important; }
.ant-pagination-item-active a{ color:#007AFF !important; }
```

### 7.16 Empty state
```scss
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 25px 20px; height: 305px; max-height: 400px;
  background: #F6F6F6; border-radius: 8px; text-align: center; overflow-y: auto;
  > h2 { font-size: 22px; font-weight: 500; margin-bottom: 20px; }
}
.empty-state-icon { width: 80px; height: 80px; margin-bottom: 20px; opacity: 0.5; }
```

---

## §8 — Iconography

- Stack: `react-icons` + `lucide-react` (+ `@ant-design/icons` if AntD).
- Default sizes: 16 / 20 / 24 px. Stroke weight `1.5–1.8`.
- Idle color `#666666` / `#707070`; hover/active `#0070C0`.
- Inline custom SVGs: `viewBox="0 0 24 24"`, `stroke="currentColor"`, `fill="none"`.

---

## §9 — Tailwind config

```js
// tailwind.config.js
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    screens: { sm:'640px', md:'768px', lg:'1024px', xl:'1280px', '2xl':'1536px', '3xl':'1880px' },
    extend: {
      colors: {
        primary:  { DEFAULT:'var(--color-primary)', light:'#3395ff', dark:'#0062cc' },
        secondary:{ DEFAULT:'var(--color-secondary, #4b5563)', light:'#9ca3af', dark:'#4b5563' },
        accent:   { DEFAULT:'var(--color-accent)', light:'#3b82f6', dark:'#1d4ed8' },
        light:'var(--color-light)', dark:'var(--color-dark)',
        uncommonColor:{ DEFAULT:'var(--color-uncommonColor)' },
        'Button-01':'#0070C0', '2nd-text':'#525252', 'BACKGROUND':'#F6F6F6',
        'Icons':'#707070', 'primary-Buttons':'#007AFF',
      },
      fontFamily: { sans: ['var(--font-sans)', 'sans-serif'] },
      fontSize: {
        xs:'var(--text-xs)', sm:'var(--text-sm)', base:'var(--text-base)',
        lg:'var(--text-lg)', xl:'var(--text-xl)', '2xl':'var(--text-2xl)',
        dynamic:'var(--text-dynamic)',
      },
      spacing: {
        0:'var(--space-0)', 1:'var(--space-1)', 2:'var(--space-2)', 3:'var(--space-3)',
        4:'var(--space-4)', 6:'var(--space-6)', 8:'var(--space-8)', 12:'var(--space-12)',
        16:'var(--space-16)', 64:'var(--space-64)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
```

```js
// postcss.config.js
module.exports = { plugins: { 'postcss-import':{}, tailwindcss:{}, autoprefixer:{} } };
```

---

## §10 — `globals.scss`

```scss
@use 'variables' as *;
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

body { margin:0; padding:0; font-family:'Roboto', var(--font-sans), sans-serif; }
.client-layout  { display:flex; flex-direction:column; min-height:100vh; background:#FFFFFF; }
.main-container { display:flex; flex:1; overflow:hidden; }
.content        { flex:1; padding:30px; background:#FFFFFF;
  @media (max-width:1024px){ padding:20px; }
  @media (max-width:768px){  padding:15px; }
}

.heading   { @apply text-2xl font-bold text-primary; font-family:'Roboto',sans-serif; }
.mdheading { @apply text-lg  font-bold;              font-family:'Roboto',sans-serif; }
.smheading { @apply text-base font-semibold;         font-family:'Roboto',sans-serif; }

/* + AntD overrides (§7.15) only if AntD is used */
/* + Toast (§7.11), Modal (§7.12), Empty-state (§7.16), Accessibility (§6) */
```

---

## §11 — Dependencies (the parts that materially shape the look)

```json
{
  "tailwindcss": "^3.4",
  "@tailwindcss/forms": "^0.5",
  "@tailwindcss/typography": "^0.5",
  "sass": "^1.88",
  "lucide-react": "^0.511",
  "react-icons": "^5.5",
  "antd": "^5.25",          // optional — only if project already uses AntD
  "@ant-design/icons": "*", // optional
  "sweetalert2": "^11"      // optional — only if project wants SweetAlert dialogs
}
```

---

## §12 — Conventions to mirror

1. CSS variables for every token; Tailwind reads them via `var(--…)`. Never hard-code colors that already exist as tokens.
2. SCSS file per top-level feature module (e.g. `_tickets.scss`, `_admin.scss`, `_reports.scss`).
3. Components in TSX; module-specific styles in SCSS. Shared atoms under `components/ui/` or `components/Common/`.
4. `'use client'` at the top of any interactive component (Next App Router).
5. Tailwind for layout, SCSS for module style + library overrides.
6. Roboto everywhere — never bare `system-ui`.
7. All hover transitions land in `0.2s–0.3s`. No instant snaps.
8. Every focusable input gets `focus:ring-2 focus:ring-[rgba(0,122,255,0.25)]` and `focus:border-[#007AFF]`.
9. Respect the three accessibility body classes from §6.

---

## §13 — Ticketing-specific token map (Axiom360)

Use these mappings when building Axiom360 surfaces. **They are derived from §2 and are authoritative for this project.** If something isn't covered, fall back to §2 and ASK.

### Priority
| Priority | Bg | Fg | Left-border (ticket card) |
|---|---|---|---|
| Urgent | `#FFEBEB` | `#FF1500` | `#FF1500` |
| High | `#FFEBEE` | `#C62828` | `#C62828` |
| Medium | `#FFC70E33` | `#D97706` | `#FFC70E` |
| Low | `#0dcaf09e` | `#00AAE8` | `#3395ff` |

### Status
| Status | Bg | Fg |
|---|---|---|
| Open | `#E9EFFF` | `#007AFF` |
| In Progress | `rgba(72,159,255,0.1)` | `#489FFF` |
| Pending | `#FFEBEB` | `#F54040` |
| Resolved | `#E4FFE4` | `#4A9E00` |
| Closed | `#EEEEEE` | `#525252` |

### Ticket card layout (atom)
- Container: soft enterprise card (§7.3) + 4px left border colored by priority.
- Top row: ticket id `12px/500/#525252` + status badge (right-aligned).
- Title: `16px/600/#1A2B3C`, single line, truncate.
- Description: `13px/400/#555`, single line, truncate.
- Footer: priority badge + assignee avatar (28px) + relative time `12px/#707070`. `gap-3 mt-3`.
- Hover: `shadow 0 2px 16px rgba(0,0,0,0.12)` and `cursor-pointer`.

### Ticket detail header
Use `PageBanner` (§7.4):
- `title` = ticket title
- `subtitle` = `#${id} • opened by ${reporter} • ${time}`
- `description` = last update summary
- `visual` = stacked priority badge + status badge

### "+ New Ticket" CTA
Top-right of navbar (§7.7):
```jsx
<button className="bg-[#007AFF] hover:bg-[#0062CC] text-white rounded-lg
                   px-4 py-2 text-sm font-medium flex items-center gap-2
                   shadow-[0_2px_8px_rgba(0,112,192,0.3)] transition-colors">
  <PlusIcon className="w-4 h-4" /> New Ticket
</button>
```
