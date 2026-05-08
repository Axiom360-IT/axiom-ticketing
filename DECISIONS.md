# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

---

## 2026-05-08 · Accessibility (M14.5)

**Decision:** Target WCAG 2.1 AA. Enforce in three layers — eslint-plugin-jsx-a11y at lint time, @axe-core/playwright at e2e time, and human review for screen-reader / contrast / keyboard walkthroughs (see README's "Accessibility" section).

**Notes / deviations:**

- **`color-contrast` rule is disabled in CI** — axe's contrast check flickers under CI's dark-mode media-query handling. Re-enable when the design system locks in tokens. Manual contrast audit is on the M14.5 carryover list.
- **Skip-link** is rendered in both the admin gated layout and the public layout. It targets `#main-content`, which is the `<main>` wrapper in each.
- **Permissions matrix and hierarchy tree** are flagged in the spec for explicit screen-reader testing. The matrix uses native `<input type="checkbox">` + associated `<label>`; the tree is a recursive `<ul><li>` with `<a>` rows. Both are intentionally markup-driven (not custom widgets) so a screen reader announces them as standard form / list controls without extra ARIA.
- **`<th scope="col">`** is the default in the shared `Table` component — every column header in the project's data tables is a column header, so we apply it once at the primitive layer rather than per call site.

---
