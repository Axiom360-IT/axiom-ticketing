# Permission tiers

Status: **implemented, not yet installed** · Last revised: 2026-10-27

A Technical Lead tier above Super Admin, and the rule that nobody can grant — or
take away — a permission or role they are not authorised to delegate.

---

## 1. The model

Three ranks, stored on `roles.rank`. Every other distinction is a role, because
roles are already data; a named tier in *code* is what you add when roles are
not.

| Rank | Who | Meaning |
|---|---|---|
| 2 | Technical Lead | Holds every permission. Nothing in the app can edit it. |
| 1 | Super Admin | Whatever the Technical Lead leaves it. |
| 0 | IT Director, Coordinator, Technician, Customer, anything custom | Operational. |

**THE rule** — `lib/auth/rank.ts`, `canManageRank(actor, target)`:

> You may change a role (edit it, delete it, grant it, take it away) only if
> your rank is **strictly higher** than the role's.

Consequences, all intended:

- **No Super Admin can edit another.** A Super Admin cannot edit the Super Admin
  role, make a new Super Admin, or remove the role from one.
- **The Technical Lead role is immutable from inside the app.** Nothing
  outranks 2. `pnpm db:add-technical-lead` is the only thing that changes it.
- Editing a *person* who is a peer (their name, their phone) is unchanged — only
  *role membership* changes are judged, so a form that resubmits someone's
  existing roles is not refused.

A user's rank is the highest among their roles. `rankOf()` also floors it by
role name (Super Admin → 1, Technical Lead → 2) so an unmigrated database or a
fixture without `rank` fails *safe*; the floor can only raise, never demote.

### Nobody acts on an account that outranks them

The rank rule on *roles* does not stop a Super Admin resetting the Technical
Lead's **password** — Super Admin bypasses the user hierarchy — and then signing
in as them. So `can()` also refuses `users.update`, `users.deactivate` and
`users.reset_password` when the target's rank is higher than the actor's. Peers
are unchanged (strictly "higher"), and impersonation immunity extends to the
Technical Lead.

---

## 2. Visibility: hidden by default, locked if you choose

`permissions.undelegable_display` — a **technical-tier** setting, so only the
Technical Lead can change it (Settings → Security → *Permission visibility*).

| Mode | What a restricted admin sees for something they cannot delegate |
|---|---|
| **`hidden`** (default) | Nothing. No row, no count, no "show locked" link. |
| `locked` | The row, greyed out, with a lock: *"You can't grant this. Ask the Technical Lead."* |

Hidden is the default because a capability people can see but not have is a
capability they will ask for. It applies to:

- the permission matrix (create/edit role)
- the role pickers when creating/editing a user
- the roles list, the role view dialog, and the **roles CSV export**
- role chips on the users list, its role filter, and the **users CSV export**

A role ranked *above* the viewer is simply absent under `hidden` — the same
answer as a role that does not exist. A role the viewer can see but not assign
(a peer's Super Admin chip) still shows on a person's row, because that is
describing people, not offering a choice.

**This is a presentation policy, not a secrecy boundary.** The edit form must
resubmit permissions the editor cannot see, or saving would silently strip them,
so the page payload does contain them. The server's refusals are the boundary.

---

## 3. Settings, split in two

`settings.update` was one permission for every setting, so business hours and
the virus-scanner endpoint were the same switch. Now every key in
`lib/settings-registry.ts` is on a side, in an exhaustive
`satisfies Record<SettingKey, …>` — TypeScript refuses to compile a setting that
has not been placed, so a new key cannot default into the weaker tier.

| Tier | Permissions | Examples |
|---|---|---|
| business | `settings.view` / `settings.update` | hours, SLA targets, holidays, who is alerted, email wording, billing, follow-up cadence |
| technical | `settings.technical.view` / `.update` | rate limits, virus scanner, sender & inbound email, file limits, retention, rule-engine internals, the visibility policy |

`rules.manage` is a third permission: a rule can email arbitrary outside
addresses and, later, change any ticket, so it is not a reading of
`settings.update`.

Enforced in `updateSetting` (per key), in `loadSettingsSnapshot` (technical
values are **withheld on the server**, not merely hidden — it is a server action
a browser can call), on the Settings page (tabs and cards), on the Automations
page (toggles and knobs), and in the sidebar (either view permission opens
Settings).

`can()` needs no new `case` for these: they are global gates with nothing to
scope, so falling through to `default: return true` *after* the holder check is
the intended behaviour. They are blocked during impersonation.

---

## 4. Where the line falls

**Technical Lead only (to prune afterwards, deliberately):** `users.impersonate`,
`roles.create/update/delete`, `tickets.merge`, `tickets.delete`, `audit.export`,
`mcp.connect`, `rules.manage`, `settings.technical.*`.

**Super Admin:** everything operational, plus users, organizations, reports,
audit view, and business settings.

**Staff:** tickets, procurement, work log, `reports.view`, `organizations.view`.

Nothing here is stripped on install — see §6.

---

## 5. What was built

| | |
|---|---|
| `lib/auth/rank.ts` | The rule, the constants, the visibility policy. Pure. |
| `lib/auth/role-authority.ts` | **One** shared decision for the UI actions *and* the MCP tools. |
| `lib/auth/permission-diff.ts` | Judges a role edit as a *delta*, both edges. |
| `lib/auth/permission-modules.ts` | The matrix groups, now tested to cover every permission. |
| `lib/settings-access.ts` | What a user may see/change in Settings. |
| `lib/roles/assignable.ts`, `lib/roles/detail.ts` | Pickers, and the unfiltered loader. |
| `db:add-role-rank` · `db:add-technical-permissions` · `db:add-technical-lead` | The installers. |

The MCP role and user tools were near-copies of the UI actions — the same trap as
the 65 places that write to `tickets`. Neither path now decides anything itself.

Role edits are judged as a **delta**, not as a whole set. Compared whole, a role
holding something the editor cannot see could not be saved by them at all, and
the error would name exactly the permission the policy hides. Both edges are
enforced: you cannot add a permission you lack, **or remove one** — previously
a crafted request could strip a permission the editor could not even see.

### Corrections to the earlier plan

- There are **45** permissions (now 48), not 71.
- There were **29** live-code `"Super Admin"` sites in 22 files, not 42 in 28;
  the rest were seeds, tests and comments.
- The permission matrix **already** hid permissions the caller lacked. The real
  gaps were: a per-viewer "N hidden — Show locked" link (the count announced
  that they exist), and **eleven modules, not eight** — `organizations.*` and
  `worklog.view_all` belonged to no group and were never rendered at all.
- `listAllRoles` was an exported server action with **no auth check**.
- IT Director is rank **0**, not 1 — rank 1 would have stopped Super Admins
  editing the IT Director role.

Six places each kept their own copy of `[Super Admin, IT Director, Coordinator,
Technician]` to decide who counts as staff. They now share `STAFF_ROLE_NAMES`;
otherwise an account holding only the Technical Lead role would be treated as an
external customer. `rank.test.ts` fails if a tier-name literal reappears outside
`rank.ts`.

Notification and escalation lists keep meaning *the Super Admin role*: the
Technical Lead is deliberately not an operational recipient.

---

## 6. Installing it

Migrations now run **automatically on a production deploy** — see
`docs/deploy-migrations.md`. `add-role-rank` and `add-technical-permissions` are
in the automatic list, in that order, and run before the new code serves a
request. Nothing needs running by hand before a push.

**First time only, recommended:** run `pnpm db:deploy-migrations` once by hand
before pushing, so the first automated build is not also the first time the
runner has touched production.

After the deploy, once:

- `pnpm db:add-technical-lead` — creates the role (rank 2, all permissions) and
  adds it to `m.luqman@axiom360.it`, who **keeps** Super Admin. Writes an audit
  entry. **Deliberately not automatic**: it grants the highest privilege in the
  system. Re-run it after any release that adds a permission.

Why the order matters: the session loader tolerates a missing `rank` column
(SQLSTATE 42703), so a mis-ordered deploy cannot take the whole site down — but
the roles screens and the last-administrator guard do not, and
`add-technical-permissions` is what stops the Settings page and the Automations
rules section vanishing for everyone who sees them today.

### Day-one behaviour change (intended)

Super Admins can no longer edit the Super Admin role, create another Super
Admin, or remove the role from one — only the Technical Lead can. Everything
else is unchanged.

### Rollback

- The scripts only add. To undo the *restriction*: nothing to do — it follows
  from the Technical Lead existing.
- To remove the Technical Lead: delete the `user_roles` row, then the role.
- Schema: `ALTER TABLE roles DROP COLUMN rank` after reverting the code.

---

## 7. Not done, deliberately

- **Nothing is stripped from Super Admin.** Doing so is a separate act, through
  Roles, once the Technical Lead is signed in and has seen it work.
- No per-organization or per-team scoping; permissions stay global.
- No time-limited elevation and no approval workflow for grants.
- Nothing has been exercised by a human: no test database, no jsdom. The pure
  rules have tests; the actions, pages and installers have `tsc`, `eslint`, a
  clean build, and `EXPLAIN` of the installer SQL against the real schema.
