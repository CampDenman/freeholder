# Freeholder restart handoff — 2026-08-31

`MASTER.md` §43 is the only product, architecture, status, and delivery source
of truth. This file is the *session* handoff: where the work stopped, what is
in flight, and what this stretch learned. It is tracked from 2026-08-31 at the
owner's instruction; earlier copies said "do not commit this file" and that
line no longer applies. Rewrite it in place rather than adding another.

## Exact repository state

- Repo: `C:\users\tony\code\freeholder`
- Remote: `https://github.com/CampDenman/freeholder.git`
- `main` is at `02e788f` (C9.07 funnel, PR #237)
- Plan gate on `main`: **275 unique IDs, 206 checked, 69 open**
- With the two open PRs below merged: **276 IDs, 208 checked, 68 open**

## In flight — one stack, two PRs

| PR | Item | Branch | Base |
|---|---|---|---|
| #238 | C9.08 reporting | `feat/c9.08-reporting` | `feat/c9.07-funnel` → retarget to `main` |
| #239 | C7.17 one audience | `feat/c7.17-one-audience` | `feat/c9.08-reporting` |

Both were stacked while C9.07 was still open. **C9.07 has since squash-merged**,
so #238 needs retargeting to `main` and rebasing with
`git rebase --onto origin/main <old-c9.07-sha> feat/c9.08-reporting`, then #239
onto the rewritten #238. A plain `git rebase main` replays the old copy of the
already-merged commit and conflicts; `--onto` drops it.

**Merging to `main` publishes the container image** (`.github/workflows/
publish-image.yml`). That is the whole deploy path: a self-hoster runs
`docker compose pull`. There is no separate deploy step.

## Landed 2026-08-31

**C9.05** message templates · **C9.06** broadcasts · **C9.07** funnel.
C9.08 and C7.17 are built and awaiting CI.

**C9.08 was split before coding**, per §43.17.1: scheduled exports and the
QuickBooks/Xero shapes moved to a new item at the end of the C9 block, defined
in PR #238. Reading a report and delivering one on a schedule have different
failure modes. (Not named by ID here: the plan gate rightly refuses a reference
to a checklist ID that is not yet on `main`.)

## What is left (68, once the stack lands)

| Stream | Open |
|---|---|
| C9 | ~21 — C9.11 onward, plus the new exports/accounting item split from C9.08 |
| C10 | 18 — updater + React Native, untouched |
| C11 | 17 — journeys through the C11.17 final gate, untouched |
| F01–F12 | 12 |
| C1.27 | 1 — dependency-blocked on the remaining C5–C9 work |

C7.17 is no longer blocked or open: broadcasts, automations and reports now all
ask §30's segment model.

## Next item

The first unchecked item whose dependencies are complete — expect that to be in
the C9.11+ block once #238 and #239 land. **C10.19** (collapse the migration
chain into one reviewed baseline) is deliberately scheduled after C10's own
tables and before C11; do not pull it forward.

## Standing instruction from the owner

**Every feature ships its admin screens in the same change as its services.**
"Definitely always need full admin functionality." A service-layer-only PR is
unfinished.

**The standard is a diamond, not a shippable v1.** Until V1.0 the objective is
a codebase with no detectable flaw; refactoring is what happens after release,
not now. Where a choice is between "works" and "true", take true and write down
why at the call site.

## Things this stretch learned the hard way

- **A stored column that nothing reads is a defect, not a placeholder.**
  `automations.entry_segment_id` had been written since C9.01 and never read,
  so an automation given an audience ran for everybody — including the people
  it was written to exclude. Its admin form also never submitted the field, and
  `saveAutomation` writes `?? null`, so renaming a rule silently widened it.
  When adopting a stored-but-unused field, check the write path *and* the form.
- **Consent has to be recorded by somebody.** C9.06's send gate asked
  `contacts.canContact("marketing", "email")`, which treats absent evidence as
  refusal — and nothing on the platform had ever recorded that evidence, so
  every confirmed subscriber was "denied". §2096 says the double opt-in *is*
  the evidence; `newsletters.confirm` now records the grant and `unsubscribe`
  the withdrawal. A gate is only as good as the thing that feeds it.
- **A test that accepts either outcome is not a test.** `broadcasts` asserted
  `sent + failed === 3` and passed while every send was being refused for want
  of a verified bulk sender. Assert the outcome you mean.
- **Provider feedback must be matched on the delivery, not the address.** The
  same person is usually on several campaigns; crediting a bounce to whichever
  mailed them most recently is a wrong number rather than a missing one.
- **Registries beat cross-module imports.** Both the funnel (C9.07) and the
  revenue dimensions (C9.08) put the vocabulary in core and let modules
  register at import time — a module that is not installed simply has no stage
  or source. Core still may not import a module: the "revenue by location"
  source lives in `invoicing` rather than `core/scheduling` for exactly that
  reason.
- **Say the basis on the screen.** A cut that counts line values will not add
  up to the revenue total, and an owner who notices without being told assumes
  something is broken.
- **Drizzle's builder can qualify a column in `group by` and not in `select`**,
  which Postgres rejects. For a grouped expression, write the query with
  `ctx.tx.execute(sql\`…\`)` and `group by 1, 2`.
- **Raw `sql\`\`` will not bind a `Date`.** Pass
  `${d.toISOString()}::timestamptz`.
- **`.next/types` poisons `tsc`** after switching branches — `rm -rf .next`
  before believing a typecheck failure.
- **Do not stack heavy local runs.** Two `eslint` runs plus a `tsc` starved
  each other into 10-minute timeouts. Run `node scripts/fast-gates.mjs` once,
  in the foreground.

## Restacking: the places that always collide

Every squash puts the other branches behind. All are "keep both":

1. `db/migrations/meta/_journal.json` — keep both entries, ordered by `idx`.
   Reserve numbers across in-flight branches: C9.06 took `0137` and C9.08 was
   numbered `0138` up front to avoid the collision.
2. `src/modules/index.ts` — keep both manifests.
3. `MASTER.md` §43 — the other branch's checked item plus this one's.
4. All three `locales/*.json`, at the same closing brace. When three or more
   branches have appended keys, `git checkout origin/main -- locales/` and
   re-run the branch's own key script; patching the markers by hand can span
   the closing brace and produce invalid JSON.

Locale files are **not sorted**, so append before the closing brace rather than
re-sorting.

## How we land work

- Name the §43 ID in the product change. Check a box only in the same change
  that supplies the evidence MASTER.md asks for.
- If an item is too large for one reviewable change, **split it in §43 first**
  (§43.17.1), with the reasoning in the entry.
- If an item's entities are not in §§1–42, the doc entry lands in the same PR
  (CLAUDE.md), or in a spec-only PR first.
- Commits are DCO signed-off (`git commit -s`).
- `main` is protected: PR + green checks only. Repository auto-merge is on, so
  `gh pr merge <n> --auto --squash` arms it; a PR that is `BEHIND` needs
  `gh pr update-branch <n>` before it will fire.
- Apache-2.0 SPDX on new files. One contact spine. One transaction via
  `ctx.call` / `ctx.callAsSystem`. Integer minor-unit money. Light+dark
  EN/FR/ES WCAG AA.

## Constraints

- Vitest `testTimeout` / `hookTimeout` are 30s, and `fileParallelism` is off.
  Charge `await ready()` to `beforeAll(..., 60_000)`: boot wires every module
  and takes several seconds, and paying for it inside the first `beforeEach`
  fails as an unrelated timeout.
- Tests run against `TEST_DATABASE_URL` (`freeholder_test`) and migrate
  themselves through `tests/setup/migrate.ts`. The dev database is separate and
  is not what a test failure is talking about.
- Migrations are hand-written. Only `_journal.json` and four legacy snapshots
  are tracked, so `db:generate` dumps the whole schema and is the wrong tool.
- `npm run gates` is the first filter, not the last word: the browser, recipe,
  SEO and upgrade gates need Docker or a built app and only run in CI.
- Do not check C3/C4/C6 boxes without the evidence line §43 shows.
- **Never merge Law Firm Edition #104 or the Dependabot PRs unless asked.**
