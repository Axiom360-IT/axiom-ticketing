# Database migrations on deploy

Status: **implemented** · Last revised: 2026-10-30

Pending migrations run automatically during a **production** Vercel build,
before the new code serves a single request.

```
git push → Vercel build:  vercel-build  →  run pending migrations  →  next build  →  traffic switches
                                                    │
                                          any failure fails the build,
                                          so the previous version keeps serving
```

## Why it is safe

| Concern | How it is handled |
|---|---|
| Wrong order (code before schema) | Migrations run in the **build**; Vercel switches traffic only after the build succeeds. |
| A migration fails | Build fails, previous deployment stays live. Migrations are additive, so that version runs fine against whatever did apply. |
| Re-running every deploy | A `deploy_migrations` ledger records each by name **after** it succeeds. A routine deploy changes nothing. |
| Preview / CI / laptop touching production | They don't. It runs only when `VERCEL_ENV=production`; the default is *skip*. |
| Build can't see `DATABASE_URL` | Fails loudly (it would otherwise ship code against an unmigrated schema). |
| A hung migration | Killed after 180 s; the build fails instead of hanging. |
| Overlapping builds | Both may run a migration; safe because they are idempotent. (The HTTP driver cannot hold an advisory lock.) |
| Already-applied migrations | `appliedProbe` adopts them into the ledger without re-running — re-running would briefly lock `tickets`/`messages` for nothing. |

## Adding a migration

1. Write `src/lib/db/add-thing.ts` — **additive, idempotent, never edited once shipped** (the ledger keys on its name; to change what it did, write a new one).
2. Add its `db:add-thing` script to `package.json`.
3. Register it in `src/lib/db/migration-manifest.ts`:
   - `DEPLOY_MIGRATIONS` — runs automatically, in listed order
   - `MANUAL_MIGRATIONS` — a person runs it (anything that grants privilege, seeds, backfills, resets)

`pnpm test` fails if a `db:add-*` script is in neither list, and if an automatic
script contains a `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`.

## Commands

| | |
|---|---|
| `pnpm db:deploy-migrations:plan` | What would run. **Writes nothing**; safe anywhere. |
| `pnpm db:deploy-migrations` | Run what is pending, by hand (same ledger). |
| `SKIP_DEPLOY_MIGRATIONS=1` | Env var: deploy without migrating. Exactly `1` only. |

## Two things to check in Vercel

1. **Settings → Build & Development → Build Command must NOT be overridden.**
   Vercel runs `vercel-build` only when no custom command is set. If one is,
   the runner is silently skipped. You'll know on the first deploy: the build
   log will show `[migrations]` lines. No lines → there is an override.
2. **`DATABASE_URL` must be exposed to the Production build**, not only runtime
   (the default). If it isn't, the build *fails* with a message saying so.

## First deploy: do it by hand once

`pnpm db:deploy-migrations` before the first push applies the pending
migrations in a controlled setting and fills the ledger, so the first automated
run finds nothing to do. It costs a minute and means the first real build is not
also the first time the runner has touched production.

## Not automatic, on purpose

`add-technical-lead` grants the highest privilege in the system. It is one
command, run once, after the deploy. See `MANUAL_MIGRATIONS`.
