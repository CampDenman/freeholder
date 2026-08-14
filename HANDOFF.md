# Freeholder handoff - C1.28

Last updated: 2026-08-13 (America/Vancouver)

## Resume point

Resume `MASTER.md` section 43 at **C1.28**:

> Make screen/window/tab, camera and microphone recording a first-class media
> workflow with explicit permission, persistent live/stop controls and safe
> capture/upload behavior.

C1.27 remains deliberately dependency-blocked until the required C5-C9
booking, commerce, gallery, conversation and reporting modules exist. Do not
weaken or fabricate those complete creator/service/shop/everything scenarios;
return to C1.27 after those domains land.

The working branch is `feat/deterministic-demos`, based on C1.25's merged main
commit `3de729c0d8d7d6f4850050307cde167db5e843d1`. C1.26 is implemented at
checkpoint `5483916`; the canonical completion/evidence update follows that
checkpoint. Protected PR delivery is the remaining C1.26 release step at this
handoff revision.

Do not commit or modify the separate untracked `RESTART_HANDOFF.md`; it is an
older local document outside this checkpoint.

GitHub requires the `DCO` and `checks` statuses but does not require
cryptographic commit signatures. Use `git commit -s` for every commit.

## C1.26 delivered behavior

- `demo_scenarios`, `demo_scenario_runs` and `demo_records` normalize immutable
  versioned definitions, one active run, lifecycle state, generation history
  and exact record provenance. Additive migrations are `0041_red_zeigeist.sql`
  and `0042_worthless_naoko.sql`.
- `ModuleManifest.onboarding` is the public core/module/plugin seam for targets,
  guidance flows, version-pinned scenarios, localized fixtures, expected
  outcomes and ordinary service names for load, purge and verify.
- Boot validates namespaces, installed dependencies, service handlers,
  capabilities, pinned fixtures, locale coverage, targets, optional selectors
  and cleanup. Identical repeated registration is idempotent; changed meaning
  at the same key/version is rejected.
- Startup persists registered guidance/scenario definitions idempotently and
  refuses stored definition drift without a version increase.
- Fixture handler services require an active matching run and exact stored
  provenance. Calling a handler directly cannot create or purge ambiguous
  records.
- `demo.load` is idempotent; `demo.reload` purges and verifies the current
  generation before advancing it; `demo.reset` purges the active run and loads
  a fresh localized run; `demo.purge` removes only proven record IDs in reverse
  dependency order and verifies every declared outcome is gone. Every
  multi-module lifecycle is one transaction.
- CMS and Forms contribute the English/French/Spanish current-module fixture.
  It creates one `[Demo]` page and one `[Demo]` form. This is intentionally a
  foundation proof, not the dependency-blocked complete C1.27 scenarios.
- Owners reach the lifecycle at `/admin/demos`. Expected-outcome links derive
  from the target registry, not hardcoded plugin knowledge.
- The hostile plugin conformance suite rejects missing modules, handlers,
  cleanup, capabilities, targets/selectors, fixture versions and foreign
  namespaces.
- `deploy/demo-scenarios.md` documents lifecycle semantics, extension rules,
  migrations, rollback and post-deploy verification. The release changeset is
  `.changeset/deterministic-demo-scenarios.md`.

## Final local evidence

- `pnpm test`: 94/94 files and 1,108/1,108 tests passed in 614.82 seconds.
- `pnpm test:browser`: 5/5 serial Chromium tests passed in 1.3 minutes,
  including accessibility, localized load/reload/reset/purge, role matrices,
  customer isolation and the existing end-to-end product journey.
- `pnpm build`: passed in 63.2 seconds; the known optional
  `@replit/object-storage` warning remains.
- `pnpm lint`, `pnpm typecheck`, `pnpm plan:check`, `pnpm license:check`,
  `pnpm dependency:audit`, changeset gate, schema compatibility and
  `git diff --check`: passed.
- Ownership drill with PostgreSQL 16 client: dump/restore and secret-safe export
  matched 92 tables, 5,133 rows, zero assets and zero media objects.
- The protected CI image/SEO/upgrade/rollback gates still need to run on the
  C1.26 PR; Docker is unavailable on this development machine.

## C1.28 discovery sequence

1. Re-read the exact C1.28 text and the media/capture requirements in
   `MASTER.md` before changing code.
2. Inspect the existing media upload lifecycle, multipart API, storage
   adapters, permissions, trash/purge behavior, admin media UI and browser
   coverage.
3. Specify capture state and recovery for screen/window/tab, camera and
   microphone permission denial, device loss, stop/cancel, upload failure,
   reload and long recordings. Do not hold large recordings entirely in React
   state or a single server request.
4. Reuse the existing media service/upload pipeline so captured media has the
   same validation, audit, storage, variants, accessibility metadata and
   lifecycle as file uploads.
5. Add real-browser permission/control tests and operator guidance before
   marking C1.28 complete.

## Constraints to preserve

- `MASTER.md` section 43 remains the sole product/delivery checklist.
- Do not mark the overall completion goal complete until every item through
  C11.17 is verified.
- No public launch or marketing work is required.
- Do not add paid services or expose secrets.
- Preserve unrelated local state, especially untracked `RESTART_HANDOFF.md`.
- Use signed commits and protected-branch PR/CI/merge flow.
- A local object-storage credential appeared in historical failed-test output
  during C1.24 validation. It was never committed or sent to GitHub; rotate it
  before reuse.
