<!--
  PR template for the Axiom Ticketing System.
  During the build phase (M0.5–M22.5) direct push to main is allowed,
  so this template is only used when you choose to open a PR for review.
-->

## Module / area

<!-- e.g. M3 — Ticket lifecycle, or "fix" for a small change -->

## What changed

<!-- 2–4 bullets describing what's in this PR -->

-

## Why

<!-- One or two sentences. Link to PRD/ARCHITECTURE section if relevant. -->

## Test plan

<!-- How you verified it works. Screenshots welcome for UI changes. -->

- [ ]
- [ ]

## Checklist

- [ ] Lint passes (`pnpm lint`)
- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Build passes (`pnpm build`)
- [ ] No hardcoded user-facing strings (post-M3.5)
- [ ] No accessibility regressions (post-M14.5)
- [ ] Audit log written for any privileged action
- [ ] Decisions/tradeoffs noted in `docs/working/DECISIONS.md` if non-obvious
