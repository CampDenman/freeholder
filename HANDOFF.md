# Freeholder handoff — C1.26

Last updated: 2026-08-13 (America/Vancouver)

## Resume point

Resume `MASTER.md` §43 at **C1.26**:

> Ship deterministic creator, service, shop and everything demo scenarios with
> realistic cross-module states, locale variants, expected-outcome journeys,
> visible isolation and idempotent one-action load/reset/purge; add module/
> plugin manifest contributions and conformance tests so any feature can add or
> revise demos and onboarding without framework changes.

The working branch is `feat/deterministic-demos`, created directly from C1.25's
merge commit `3de729c0d8d7d6f4850050307cde167db5e843d1` on synchronized `main`.
No C1.26 implementation exists yet. Complete repository discovery and split the
checklist item in `MASTER.md` before coding if one reviewable change cannot
honestly satisfy the full contract.

C1.25 is delivered in PR #96. PR CI `31762010303`, post-merge CI
`31762514806`, and image publication `31762514808` all passed; the latter
includes keyless signing, provenance, SBOM and SBOM attestation.

Do not commit or modify the separate untracked `RESTART_HANDOFF.md`; it is an
older local document outside this checkpoint.

GitHub requires the `DCO` and `checks` statuses but does not require
cryptographic commit signatures. Use `git commit -s` for every C1.26 commit.

## Verified baseline

- Apache-2.0 relicensing is merged in PR #89.
- C1.23 ownership recovery is merged in PR #94 at `030a4ab`.
- C1.24 fresh seeded home is merged in PR #95 at `dd34df7`.
- C1.25 role guidance is merged in PR #96 at `3de729c` with green PR and
  post-merge evidence.
- `main` and `origin/main` were synchronized before the C1.26 branch was
  created.
- `MASTER.md` marks C1.25 complete and names C1.26 as the current focus.

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

## Local acceptance evidence

- The final isolated `pnpm test` run against the dependency-patched checkpoint
  passed 91/91 files and 1,098/1,098 tests in 506.96 seconds. A separate earlier
  clean run passed the same counts in 551.76 seconds.
- `pnpm test:browser` passed all four serial Chromium tests in 46.8 seconds:
  real-browser accessibility, the full product journey, staff-role forbidden-
  control matrices, and customer/admin isolation.
- `pnpm build` passed in 64.7 seconds. The known optional
  `@replit/object-storage` warning remains.
- `pnpm ownership:drill` passed with the PostgreSQL 16 client: backup, restore
  and secret-safe export matched 89 tables, 4,865 rows, zero assets and zero
  media objects.
- `pnpm plan:check`, `pnpm typecheck`, `pnpm lint`, `pnpm license:check`,
  `pnpm dependency:audit`, `git diff --check`, the changelog gate, the schema-
  compatibility gate, and shell syntax checks passed on the final worktree.
- The dependency audit discovered that GHSA-2v37-7h3g-55p8 was updated to mark
  Nano ID 3.3.17 vulnerable. The bounded `nanoid@3` override and lockfile now
  resolve 3.3.18; the audit and frozen install pass.
- Docker is intentionally unavailable on this development machine. The image,
  seeded public-site/SEO, and previous-image upgrade/rollback gates remain the
  protected CI evidence, as documented directly in `.github/workflows/ci.yml`.
- `guidance.list` remains a query intentionally. Its physical write refreshes
  only an idempotent projection from durable evidence; it creates no completion
  evidence or audit claim. Classifying each dashboard view as a mutation would
  produce false audit entries. Focused tests prove real-evidence completion,
  retry idempotence and capability-change reactivation.

## Resume sequence

1. Inspect the current seed/demo schema, services, boot path, reset/purge
   helpers, browser fixtures, module manifest, plugin seams and guidance
   definition registry before changing code.
2. Map the exact creator, service, shop and everything scenario states and
   expected-outcome journeys against existing modules and seed capabilities.
3. Decide whether C1.26 is one reviewable change. If not, split it in
   `MASTER.md` before implementation without weakening its acceptance contract.
4. Design manifest contributions so a fixture plugin can add or revise demo
   and onboarding material without editing the core scenario loader.
5. Implement only after that discovery, preserving deterministic load/reset/
   purge, locale variants, visible isolation and the C1.25 guidance registry
   seam.

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
