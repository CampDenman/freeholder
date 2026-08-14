# Freeholder handoff - C5 commerce

Last updated: 2026-08-14 (America/Vancouver)

## Resume point

Resume `MASTER.md` section 43 at **C5.04 and C5.06**:

> Finish jurisdiction-correct tax templates beyond the safe standard-rate
> starters, then connect manual/offline, Stripe and PayPal to the normalized
> money spine with signed/idempotent webhooks.

C5.01, C5.02, C5.03 and C5.05 are implemented on the current feature branch.
C5.04 remains open because the source-attributed catalog deliberately ships
standard/base starters with activation interlocks, not a false claim of complete
US address-level local tax or every reduced/exempt category. C5.06 and the rest
of commerce also remain open; do not mistake a real invoice/payment ledger for
a functioning checkout.

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

## C5 money/tax checkpoint delivered behavior

- The `invoicing` module owns 14 normalized tables for categories, zones,
  rates, registrations, exemptions, invoice sequences, invoices/lines,
  immutable tax lines, payments, refunds, credit notes/lines and state events.
- Money uses integer minor units and six-decimal fixed quantities. Unsafe,
  floating, negative, underflow and inconsistent totals are refused in services
  and backed by PostgreSQL checks.
- Draft, issue/view/overdue/void, partial/multi-payment, cancellation, refund
  reservation/settlement/cancellation, credit note, receipt and reconciliation
  services are idempotent, audited and projected through the normal API/MCP
  registry. Number allocation and settlement are transaction/concurrency safe.
- Taxes match the most-specific country/region/postal zone and support category
  overrides, shipping, effective dates, inclusive/exclusive prices, compound
  order, line/invoice scope, half-up/bankers rounding, exemptions and reverse
  charge. Rates use integer PPM so 9.975% is exact.
- Invoices retain the matched zone and immutable rate/registration/calculation
  evidence. A matching zone without active collection records an explicit
  explanation rather than silently showing zero.
- Threshold reports never combine currencies and show gross, refunds, net,
  transaction count, remaining amount and progress.
- The catalog contains 94 dated/source-attributed starters: 13 Canada, 27 EU,
  UK, Australia, New Zealand and 51 US state/DC bases. Installation is
  idempotent and monitoring-only; activation requires explicit review.
- Contact merge undo, privacy export/erasure, role grants, events, module-table
  ownership, generated services and completeness registries include commerce.
- Additive migrations are `0043_worried_shaman.sql`,
  `0044_nervous_maelstrom.sql` and `0045_peaceful_puck.sql`. Operator guidance
  is `deploy/commerce-money.md`; release note is
  `.changeset/commerce-money-foundation.md`.

## C5 money/tax local evidence

- Focused commerce/concurrency/completeness gate: 4 files, 29 tests passed.
- Isolated diagnosis gate after a machine-load timeout: agent, demo, locale and
  commerce suites, 5 files/72 tests passed.
- Final uncontended `pnpm test`: 97 files/1,137 tests passed in 990.41 seconds.
- `pnpm build`: passed in 69.2 seconds; the known optional
  `@replit/object-storage` warning remains.
- `pnpm lint`, `pnpm typecheck`, `pnpm plan:check`, `pnpm license:check`,
  dependency audit, changelog gate, schema compatibility and `git diff --check`
  passed. The standalone Changesets status command still encounters the
  pre-existing legacy `admin-shell` package changeset; the repository's
  authoritative changelog gate passes.

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

## Last merged baseline evidence

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

1. Finish C5.04's product/category and address-level jurisdiction rules without
   weakening the starter activation interlocks.
2. Implement C5.06 manual/offline, Stripe and PayPal adapters against the one
   existing payment/refund state machine and reconciliation surface.
3. Continue C5.07-C5.08 provider parity and advanced money behavior without a
   second ledger.
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
