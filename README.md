# Axiom360 Ticketing System

A custom-built internal and external IT ticketing system for **Axiom360**, replacing a third-party tool that the company cannot modify. Owned and operated entirely by Axiom — no vendor lock-in.

> **Status:** Pre-development. M0 (project scaffolding) just complete. Application code begins at M1 (database + auth core). See [`docs/EXECUTION.md`](docs/EXECUTION.md) for the full module-by-module build plan.

---

## What this system does (in one paragraph)

The system handles support requests for both Axiom's external clients and Axiom's own internal staff through a single dashboard. Customers submit tickets via a web form, by email, or by phone (the coordinator creates tickets on their behalf). Each ticket gets a human-readable number (`AX-0042`), is assigned to a technician by the coordinator, moves through a strict status workflow, and is only closed once the customer confirms they're satisfied (the *"customer has the last word"* loop — the system's signature feature). Support for procurement requests, escalation to the IT Director, customer satisfaction tracking, an audit log, role-based permissions with custom roles, in-app notifications, SMS reminders, and a reporting dashboard are all included in the MVP. AI features (voice assistant, knowledge base) are deferred to Phase 2.

For the full picture, read [`docs/PRD.md`](docs/PRD.md).

---

## Repository layout

This repository is organised as a **single project with documentation at the root and the application code in a subdirectory**. The git repo is initialised at the parent (this) level, so commits capture both code and docs together.

```
Axiom Ticketing System/                 ← repo root
├── README.md                           ← you are here
├── .env.example                        ← env-var template (commit this)
├── .env.local                          ← real values (gitignored)
├── .gitignore                          ← root-level ignore rules
├── .claude/                            ← Claude Code project config
│
├── docs/                               ← project documentation
│   ├── PRD.md                          ← what we're building (and why)
│   ├── ARCHITECTURE.md                 ← how the system is built
│   ├── EXECUTION.md                    ← 24-module sequential build plan
│   ├── PHASE2.md                       ← deferred work (Phase 2 / Phase 3+)
│   └── admin-mock.html                 ← RBAC pattern reference (architectural inspiration only)
│
└── axiom-ticketing/                    ← Next.js application
    ├── package.json                    ← deps & scripts
    ├── next.config.ts                  ← Next.js config (React Compiler enabled)
    ├── tsconfig.json                   ← TS strict; @/* → ./src/*
    ├── eslint.config.mjs               ← ESLint flat config
    ├── postcss.config.mjs              ← Tailwind v4 via PostCSS
    ├── AGENTS.md                       ← Next.js 16 agent rules
    ├── CLAUDE.md                       ← imports AGENTS.md for Claude Code
    ├── public/                         ← static assets
    └── src/
        └── app/
            ├── layout.tsx              ← root layout (Geist fonts)
            ├── page.tsx                ← default welcome page (will be replaced)
            └── globals.css             ← Tailwind v4 CSS-first config + theme tokens
```

---

## Documentation map

These four documents are the canonical source of truth for the project. Read them in this order if you're new:

| Document | What you'll find | When to read |
|----------|------------------|--------------|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: users, roles, ticketing workflow, RBAC, security mandates, settings, reporting, admin-panel UX | First — to understand *what* the system does |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Technical design: stack pinning, repo layout, full DB schema, the `can()` permission gate, server actions, webhooks, background jobs, deployment | Second — to understand *how* it's built |
| [`docs/EXECUTION.md`](docs/EXECUTION.md) | 24-module sequential checklist with definition of done per module — the active build tracker | While building |
| [`docs/PHASE2.md`](docs/PHASE2.md) | Deferred features (AI voice, knowledge base, multi-tenancy, integrations, etc.) | When the MVP is done and you're planning what comes next |

**Reference (not source of truth):** `docs/admin-mock.html` is an external mockup whose RBAC *pattern* (Super Admin, hierarchy, "can't grant what you don't have") inspired the project's permissions model. Its content (modules, role names) is not used here — see PRD §5.11.

---

## Tech stack

Pinned to security-patched versions verified for late 2025 / early 2026 vulnerabilities (Next.js RCE chain, axios supply-chain compromise, etc.). See [`docs/ARCHITECTURE.md` §2](docs/ARCHITECTURE.md) for full rationale.

| Layer | Choice | Version |
|-------|--------|---------|
| Runtime | Node.js | 24 LTS |
| Package manager | pnpm | 10.x |
| Frontend + Backend | Next.js (App Router) | 16.2.4 |
| UI framework | React | 19.2.x |
| Performance | React Compiler (auto-memo) | 1.0.0 (enabled) |
| Database | PostgreSQL on Neon | latest |
| ORM | Drizzle ORM | 0.45.x (added in M1) |
| Auth | Better Auth | 1.6.x (added in M1) |
| File storage | Cloudflare R2 (S3-compatible) | — |
| Outbound email | Resend + React Email | 6.12.x / 1.0.x |
| Inbound email parsing | mailparser | 3.9.x |
| SMS | Twilio | 6.0.x |
| Background jobs | Inngest | 4.2.x |
| Forms / validation | React Hook Form + Zod | 7.75.x / 4.4.x |
| UI primitives | shadcn/ui (CLI 4.6.x) — copied into repo | — |
| Styling | Tailwind CSS | 4.x (CSS-first config) |
| Icons | lucide-react | latest |
| Bot protection | Cloudflare Turnstile | — |
| Rate limiting | Upstash Redis + `@upstash/ratelimit` | — |
| Charting | Recharts | latest (added in M13) |
| HTTP client | native `fetch()` — **no axios** | — |
| Errors | Sentry (`@sentry/nextjs`) | 10.51.x |
| Logging | Pino | 10.3.x |
| Tests | Vitest (unit) + Playwright (e2e) | 4.1.x / 1.59.x |
| Hosting | Vercel | — |

**Why no axios?** A maintainer-account compromise on March 31, 2026 published malicious `axios@1.14.1` and `axios@0.30.4` packages containing a remote-access trojan. We use native `fetch()` to avoid the supply-chain risk. See [`docs/ARCHITECTURE.md` §2](docs/ARCHITECTURE.md).

---

## Local development

The Next.js application lives inside `axiom-ticketing/`. All `pnpm` commands must be run from that directory.

### One-time setup

```bash
cd axiom-ticketing
pnpm install
```

Copy environment variables from the root template into the app:

```bash
# from repo root
cp .env.example .env.local   # if you haven't already
# fill in real values; see "Environment variables" below
```

Next.js loads `.env.local` from the project's working directory. Two valid setups:

- **Easiest:** keep `.env.local` at the repo root *and* symlink it into `axiom-ticketing/`:
  ```bash
  ln -s ../.env.local axiom-ticketing/.env.local
  ```
- **Alternative:** maintain two copies (one at root for tooling that reads it, one inside `axiom-ticketing/` for `pnpm dev`). The symlink approach is preferred — single source of truth.

### Running the dev server

```bash
cd axiom-ticketing
pnpm dev
```

Opens `http://localhost:3000` with Turbopack. The default scaffold page renders until M3 replaces it.

### Other scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Run a production build locally |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest unit suite |
| `pnpm test:e2e` | Run Playwright + axe-core a11y suite |

---

## Accessibility

The app targets **WCAG 2.1 AA**. Three layers enforce it:

1. **Static lint** — `eslint-plugin-jsx-a11y` is part of `pnpm lint`. CI fails on any rule violation.
2. **Runtime axe-core** — `pnpm test:e2e` runs the Playwright suite at `e2e/`, which boots `next dev` and executes `@axe-core/playwright` against every covered route. New routes should add a block to `e2e/a11y.spec.ts`. The CI gate is "zero AA violations."
3. **Manual checks** — keyboard-only walk, NVDA/VoiceOver pass, and colour-contrast audit (≥ 4.5:1 body, ≥ 3:1 UI elements). Track exceptions in `DECISIONS.md`.

### Accessibility carryover

These checks need a human at a real device — not yet automated:

- Screen reader (NVDA / VoiceOver) walkthrough on every flow.
- Colour-contrast verification on every distinct foreground / background combination (axe's `color-contrast` is currently disabled in the CI suite because of CI dark-mode flakiness; re-enable once the design system stabilises).
- Keyboard-only navigation walkthrough on every flow per the M14.5 checklist.

---

## Environment variables

A complete template is in [`.env.example`](.env.example) at the repo root. Categories:

| Group | Vars | Set up in |
|-------|------|-----------|
| Neon (database) | `DATABASE_URL` | M0 |
| Better Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | M0 (used in M1) |
| Cloudflare R2 (file storage) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | M0 (used in M5) |
| Resend (email) | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | M0 (webhook secret in M4) |
| Twilio (SMS) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | M0 (used in M10) |
| Inngest (background jobs) | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | M0 (used in M3 onward) |
| Cloudflare Turnstile (bot protection) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | M0 (used in M16) |
| Upstash Redis (rate limiting) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | M0 (used in M16) |
| Token secrets (HMAC) | `GUEST_TOKEN_SECRET`, `CSAT_TOKEN_SECRET` | M0 (used in M3) |
| Sentry (errors) | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | M0 (used in M20) |
| App | `NEXT_PUBLIC_APP_URL`, `LOG_LEVEL` | M0 |

**Generate the three secrets locally:**

```bash
openssl rand -base64 32   # run three times for BETTER_AUTH_SECRET, GUEST_TOKEN_SECRET, CSAT_TOKEN_SECRET
```

**Production:** set every variable in Vercel under **Settings → Environment Variables** for the `Production`, `Preview`, and `Development` environments.

---

## Build plan

The build follows a strict, sequential 24-module plan in [`docs/EXECUTION.md`](docs/EXECUTION.md). The current state is:

| Module | Status |
|--------|--------|
| **M0** — Pre-flight setup | ⏳ in progress (DNS access deferred; everything else done) |
| M1 — Database + auth core | not started |
| M2 — Admin shell | not started |
| M3 — Ticket lifecycle | not started |
| ... (M4–M23) | not started |

Each module is shipped (committed + deployed) before the next one starts. No artificial week boundaries — done is the only signal. See [`docs/EXECUTION.md`](docs/EXECUTION.md) for the full checklist and definition-of-done per module.

---

## Working conventions

Three working files live at the repo root and are updated continuously during the build (created during M0):

- **`DECISIONS.md`** — non-obvious decisions made during the build, one line each. Rationale lives here so it's not lost in commit messages.
- **`JOURNAL.md`** — daily build journal. Two lines per day: what shipped today, what's next.
- **`BACKLOG.md`** — anything noticed but deferred. Triaged later.

**Commit message convention:**
- `M<n>: <short summary>` for module-completion commits (e.g. `M3: ticket lifecycle complete`).
- Smaller in-progress commits inside a module use a regular descriptive message — no strict format required for solo work.

**Branching:** trunk-based. Work on `main`. Optional short-lived feature branches if you want a checkpoint before merging.

---

## Deployment

- **Hosting:** Vercel, auto-deploys on push to `main`.
- **Database:** Neon. Each PR (when used) gets a database branch automatically. Production runs on a paid tier with ≥ 30-day point-in-time recovery (provisioned in M21).
- **File storage:** Cloudflare R2 with object versioning enabled.
- **Domains:** application domain + dedicated email-sending sub-domain (DNS records — SPF, DKIM, DMARC — added in M19).
- **Cron / background jobs:** Inngest (functions registered at `/api/inngest`). Vercel Cron is *not* used — Inngest covers both scheduled and event-driven work.

The first deploy happens at the end of M0 (default Next.js page on a Vercel preview URL). Real functionality begins shipping with M3.

---

## Confidentiality

This repository is **proprietary and confidential — Axiom360 internal use only.** Do not share access externally without authorisation from Axiom360 leadership.

---

## Contact

- **Project owner:** Junaid Ahmed (Axiom360)
- **Lead developer:** sole developer (you, reading this)
- **First internal user:** Evelyn (Coordinator) — to receive the system after M23
