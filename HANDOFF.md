# Freeholder handoff — C1.25

Last updated: 2026-08-13 (America/Vancouver)

## Resume point

Resume `MASTER.md` §43 at **C1.25**:

> Build resumable, role/capability-derived onboarding for owner,
> administrator, editor, bookkeeper, service provider and customer, with
> first-win tasks, contextual relaunch, skip/reset, progress and forbidden-
> control accessibility/permission tests.

The working branch is `feat/role-onboarding`, created directly from `main` at
merge commit `dd34df798435c65d5f39e8dd60177fb655f65a5c`. C1.25 is split across
two product commits:

- `0b3ccdb` (`feat: establish role guidance foundation`) adds the schema,
  definitions, migration and core services;
- `eb3c9e7` (`feat: add role guidance surfaces`) adds the admin/portal UI,
  focused service and markup tests, and browser acceptance specifications.
- `6454629` (`docs: prepare role guidance operations`) adds the localized
  action-error callout, release changeset and operator runbook.
- `9482069` (`test: satisfy role guidance lint`) validates parsed migration
  JSON through the guidance schema and removes the two whitespace failures.

The feature is intentionally incomplete. Focused service/UI tests, TypeScript,
lint, the production build and all changed browser specifications pass. The
full suite/repository gates have not completed. Do not update `MASTER.md` or
open the PR until that evidence is green.

Do not commit or modify the separate untracked `RESTART_HANDOFF.md`; it is an
older local document outside this checkpoint.

`origin/feat/role-onboarding` remains at `f08fb30`. The UI checkpoint,
operations checkpoint and updated handoffs are local-only shutdown commits, so
the branch will be eight commits ahead of its tracked remote after this document
is committed.

## Verified baseline

- Apache-2.0 relicensing is merged in PR #89.
- C1.23 ownership recovery is merged in PR #94 at `030a4ab`.
- C1.24 fresh seeded home is merged in PR #95 at `dd34df7`.
- `main` and `origin/main` were synchronized before this branch was created.
- `MASTER.md` marks C1.24 complete and names C1.25 as the current focus.

C1.24 now provides this contract:

- a truly pristine development database installs Aurora Coast automatically;
- production remains opt-in with `FREEHOLDER_SEED_DEMO=1`;
- `FREEHOLDER_SEED_DEMO=0` deliberately preserves a blank development setup;
- implicit development seeding refuses a database with an owner or business
  profile already in progress;
- a copied `.env.example` treats blank optional placeholders as unset;
- a seeded demo remains claimable through the normal `/setup` owner form;
- unexpected seed failures stop startup instead of silently serving the setup
  placeholder;
- the clean-image gate verifies `/` contains the business identity, authored
  H1, header, footer and generated media before any owner or repair write.

## Evidence

Local C1.24 verification:

- `pnpm test`: 88 files, 1,085 tests passed in 738.54 seconds;
- `pnpm build`: passed (the known optional `@replit/object-storage` warning
  remains);
- `pnpm lint`, `pnpm typecheck`, `pnpm plan:check`, `pnpm license:check`,
  `pnpm dependency:audit`: passed;
- `bash -n scripts/public-gates.sh`: passed;
- schema compatibility, changeset and diff checks: passed.

GitHub evidence:

- PR #95 CI: run `31718491259`, passed in 9m27s, including the 1,085 tests,
  ownership restore drill, build, real-browser gates, image smoke, seeded-home
  gate, SEO, schema, upgrade and changeset gates;
- post-merge CI: run `31719359788`, success on `dd34df7`;
- post-merge image publication: run `31719359728`, success on `dd34df7`,
  including push, keyless signature, provenance, SBOM and SBOM attestation.

The ownership-export integration test now has an explicit 30-second timeout.
Its every-table export and media inventory take roughly 5–9 seconds locally;
the former five-second default caused a timeout after the operation completed,
not an assertion or export-integrity failure.

## C1.25 implementation checkpoint

Repository discovery is complete. The remaining contract files, migration
conventions, customer magic-link linkage, admin navigation and portal privacy
surface were inspected before implementation.

Commit `0b3ccdb` contains this foundation:

- `src/core/guidance/schema.ts` defines versioned `guidance_flows` and
  per-user `guidance_progress`. Progress stores completed and seen steps,
  active/dismissed/completed state, start/completion/dismissal timestamps and
  database invariants. `seen_steps` is deliberate: when a newly granted
  capability exposes another step, a completed or skipped flow reactivates.
- `db/migrations/0040_curved_purple_man.sql`, its snapshot and journal entry
  create the tables and install all six core version-1 definitions. The SQL
  seed was appended after Drizzle generation and must stay byte-for-behavior
  consistent with the TypeScript definitions.
- `src/core/guidance/definitions.ts` validates capabilities, steps, internal
  targets and outcome predicates with Zod. It defines owner, administrator,
  editor, bookkeeper, service-provider and customer first-win flows.
- Roles rank the most relevant lesson; they do not authorize it. Any flow with
  capability prerequisites is available to a custom role holding the same
  effective grants. Every individual step is filtered again by its own grants.
  The grant-free customer flow remains audience-scoped.
- The shipped outcomes are real product facts: service audit actions, a form
  submission after the flow began, or a linked customer portal account. There
  is no mark-complete/next-click API.
- `src/core/guidance/service.ts` implements list/reconcile, start/resume,
  dismiss (the "skip for now" behavior), and reset. Reconciliation records
  completed steps from durable evidence and reactivates a flow when a newly
  visible capability step appears.
- Guidance tables/services are registered in core. First-owner recovery and
  both database reset helpers seed immutable core definitions.
- English, French and Spanish catalog entries for the six flows, their tasks,
  progress and controls are present and parse as valid JSON.

Commit `eb3c9e7` builds the human-facing checkpoint on that foundation:

- `src/ui/GuidancePanel.tsx` renders a semantic shared panel with a native
  progress element, ordered tasks, explicit state text and start/resume,
  skip-for-now and reset forms. Links exist only for capability-authorized
  steps and only while a flow is active or complete.
- The admin overview embeds the preferred flow. `/admin/guidance` lists all
  eligible flows, and the admin shell exposes a path-aware contextual
  "Guided help" link derived from safe server-side contexts.
- The authenticated portal privacy page embeds the customer flow and a
  contextual relaunch anchor. Stable target IDs were added for portal privacy
  preferences and the admin notification schedule.
- Admin and portal server actions call the core lifecycle services and return
  to validated internal paths.
- `guidance.contexts` exposes only capability-filtered relaunch targets without
  reconciling progress.
- The pre-existing dashboard permission bug is fixed: contact and event data
  are queried and rendered only when the actor holds the corresponding view
  capability, so editor and other restricted roles can load the overview.
- Focused tests cover all six roles, capability-derived custom roles,
  migration/TypeScript seed parity, durable real-outcome completion,
  per-user resume/skip/reset, newly granted steps, inaccessible flows, semantic
  markup and the absence of forbidden links.
- Browser specifications now cover the owner completion journey, contextual
  help, administrator skip/resume/reset, staff-role permission matrices,
  customer isolation and accessibility assertions.
- `deploy/role-guidance.md` documents rollout, versioning, rollback, role
  expectations and post-deploy checks. `.changeset/role-guidance.md` records
  the release-facing feature.
- Failed admin actions now render a localized accessible danger callout rather
  than silently carrying an unused error query parameter.

## Verification at shutdown

- `pnpm exec vitest run tests/core/guidance-definitions.test.ts
  tests/core/guidance.test.ts tests/core/guidance-ui.test.ts` passed: 3 files,
  13 tests. The database-backed tests exercise the migration and lifecycle.
- `pnpm typecheck` passed after all current UI, service and browser-spec edits.
- `pnpm build` passed in 89.9 seconds. The known optional
  `@replit/object-storage` warning remains.
- `tests/browser/guidance.spec.ts` passed: 2 tests in 10.0 seconds, covering
  the staff-role permission matrix and customer/admin isolation.
- The changed `tests/browser/accessibility.spec.ts` and
  `tests/browser/journeys.spec.ts` passed: 2 tests in 48.6 seconds, including
  axe coverage, portal progress, owner real-outcome completion and contextual
  skip/resume/reset.
- All three locale catalogs parse as JSON.
- `pnpm lint` passed in 34.6 seconds after the migration JSON was parsed as
  `unknown` through the executable guidance steps schema.
- `git diff --check` passed after removing the two trailing blank lines from
  `.changeset/role-guidance.md` and `deploy/role-guidance.md`.
- A complete `pnpm test` attempt returned after 660.6 seconds: 90/91 files and
  1,094/1,098 tests passed. All four failures were in
  `tests/core/spine.test.ts` and showed another owner/user appearing between
  that file's per-test truncations. This matched an overlapping Vitest process
  left alive when an earlier buffered shell was terminated; do not interpret
  the four assertions as product failures or as a green full-suite result.
- `pnpm exec vitest run tests/core/spine.test.ts` then passed all 38 tests in
  isolation in 26.9 seconds, confirming the failed assertions are not
  reproducible within that file alone.
- A fresh full-suite rerun was started after checking for stray workers, but
  its monitoring host was lost and shutdown was requested before a result. The
  exact new `pnpm`/Vitest process tree (PIDs 25808, 27504 and 21432) was
  explicitly stopped. This rerun is non-evidence and must be repeated.
- A subsequent turn again confirmed there were no test workers before starting
  one isolated `pnpm test`. The turn was deliberately aborted for shutdown
  before Vitest returned a result; its exact process tree (PIDs 16820, 8028 and
  22592) was explicitly stopped, and a follow-up process query found no
  remaining Vitest or `pnpm test` worker. This attempt is also non-evidence.
- The full Vitest suite has not produced a clean isolated result, and the
  remaining repository gates have not run against this checkpoint. Do not
  treat C1.25 as accepted.
- Git signing was attempted, but the configured GPG identity has no private key
  in this environment. The eight local commits after `f08fb30` are therefore
  unsigned checkpoints. Restore the signing key and re-sign/recreate them
  before the protected PR flow if required.

One design detail deserves review before acceptance:

- `guidance.list` is declared as a query but reconciles derived progress inside
  its transaction. Focused tests now prove retry/idempotence, and it never
  creates fake completion evidence, but confirm this read/write service
  semantic is intentional before the PR.

## Resume sequence

1. Confirm no Vitest/pnpm worker from 2026-08-13 is alive, then rerun the
   complete `pnpm test` suite exactly once and record its final file/test
   counts. The overlapping and interrupted runs are not acceptance evidence.
2. Review the remaining `guidance.list` read/write semantic above.
3. Run every remaining repository gate in the normal C1
   acceptance sequence.
4. Update `MASTER.md` only after all acceptance evidence is green.
5. Restore signing capability, prepare signed commits as required, push the
   branch, and use the protected PR/CI/merge/post-merge verification flow.

C1.26 still owns deterministic demo scenarios and general module/plugin
manifest contributions/conformance. Do not pull that separate checklist item
into C1.25, but preserve the current versioned registry seam for it.

## Constraints to preserve

- `MASTER.md` §43 remains the sole product/delivery checklist.
- Do not mark the overall completion goal complete until every §43 item through
  C11.17 is verified.
- No public launch or marketing work is required.
- Do not add paid services or expose secrets.
- Preserve unrelated local state, especially untracked `RESTART_HANDOFF.md`.
- Use signed commits and protected-branch PR/CI/merge flow.
- A new object-storage credential value appeared in local failed-test output
  during C1.24 validation. It was never committed or sent to GitHub, and its
  value is intentionally absent here. Rotate that local credential before it
  is used again.
