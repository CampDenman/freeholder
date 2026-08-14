# Freeholder handoff - C5 commerce

Last updated: 2026-08-14 (America/Vancouver)

## Resume point

Resume `MASTER.md` section 43 at **C5.01**:

> Land `none` plus real adapter contracts for payments, tax, calendar, SMS,
> bulk mail, AI, social, shipping/carrier and point-of-sale edges.

C5.01 is implemented in the current worktree. After its full gates and signed
checkpoint, advance the resume point to C5.02/C5.05's tax and normalized money
spine; do not mistake adapter contracts for a functioning checkout.

Commerce is now the active functional workstream by owner decision. C1.28–C4
remain open and unchanged; the priority deviation is recorded beside C5 in
`MASTER.md`. C1.27 remains deliberately dependency-blocked until the required
C5–C9 domain modules exist.

The working branch is `feat/commerce-money-foundation`, created from C1.26's
merged main commit `bcb9dd1cda83972f82ea3f129ac981aea0823458`. The separate
`feat/media-capture` branch preserves its clean C1.28 documentation checkpoint
at `c90456d`; do not mix that checkpoint into commerce.

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
- PR CI `31765933788` passed in 9m41s, including tests, ownership restore,
  build, browser journeys, image build/serve, SEO, schema compatibility and
  previous-image upgrade/rollback.
- Post-merge CI `31766451361` passed on `bcb9dd1`. Image publication
  `31766451453` passed in 2m9s with push, keyless signature, provenance, SBOM
  and SBOM attestation.
- Docker remains unavailable on this development machine; the protected CI
  runs above are the Docker/image evidence.

## C5 commerce sequence

1. Land C5.01 adapter contracts and safe `none` implementations without
   fabricating provider behavior.
2. Build C5.05's normalized invoice/payment/refund/credit-note money spine with
   integer minor-unit invariants, explicit state transitions and idempotency.
3. Add the tax engine and jurisdiction templates before checkout can quote a
   final amount.
4. Build catalog/pricing, then inventory/shipping, then carts/checkout/orders;
   every mutation remains one service-layer transaction and every customer
   reference joins the existing Contact spine.
5. Check a C5 item only after its migrations, services, user surface, hostile
   and concurrency coverage, operator docs, changeset and full gates exist.

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
