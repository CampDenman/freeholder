# Freeholder handoff - C5 commerce

Last updated: 2026-08-14 session closeout (America/Vancouver)

## Resume point

Resume `MASTER.md` section 43 at **C5.04 and C5.10**:

> Finish jurisdiction-correct tax templates beyond the safe standard-rate
> starters, then build option dimensions, generated variant matrices and safe
> reconciliation on the completed product lifecycle and money ledger.

C5.01, C5.02, C5.03 and C5.05-C5.09 are implemented and landed on `main`.
C5.04 remains open because the source-attributed catalog deliberately ships
standard/base starters with activation interlocks, not a false claim of complete
US address-level local tax or every reduced/exempt category. C5.10 and the rest
of commerce remain open. Products, provider adapters and advanced money are
real, but products do not yet have option matrices or pricing and public cart
checkout does not exist until C5.21.

Commerce is now the active functional workstream by owner decision. C1.28–C4
remain open and unchanged; the priority deviation is recorded beside C5 in
`MASTER.md`. C1.27 remains deliberately dependency-blocked until the required
C5–C9 domain modules exist.

The implementation baseline is protected `main` at C5.09 merge commit
`340aa8e886cdfa8639619013c33609faf4798875`. There is no active commerce
implementation branch. This closeout is being prepared on
`docs/commerce-session-handoff`; after it lands, branch from fresh `main` as
`feat/commerce-variant-matrices` for C5.10. The separate `feat/media-capture`
branch preserves its clean C1.28 documentation checkpoint at `c90456d`; do not
mix that checkpoint into commerce.

Do not commit or modify the separate untracked `RESTART_HANDOFF.md`; it is an
older local document outside this checkpoint.

GitHub requires the `DCO` and `checks` statuses but does not require
cryptographic commit signatures. Use `git commit -s` for every commit.

## Landed session checkpoints

- C5.08 advanced money landed in PR #101 at merge commit
  `b6b8665c8a6cb0a9336e20fbb10ef295cad51ec1`. Protected PR CI
  `31851161650`, post-merge CI `31851819756` and image publication
  `31851819702` passed.
- C5.09 product lifecycle landed in PR #102 at merge commit
  `340aa8e886cdfa8639619013c33609faf4798875`. Protected PR CI
  `31856074057` passed in 10m48s; post-merge CI `31856575007` passed in
  11m44s; production image publication `31856574998` passed.
- The latest release notes remain the unconsumed Changesets
  `.changeset/commerce-advanced-money.md` and
  `.changeset/commerce-product-lifecycle.md`. Do not add a second changelog;
  Changesets is this repository's release-note source.
- No production migration, credential change, live provider call or public
  storefront deployment was performed manually in this session. The normal
  protected workflow built and published the production image after each merge.

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

## C5.06 payment-provider checkpoint delivered behavior

- One registry contract now owns manual/offline, Stripe Checkout and PayPal
  Orders v2 checkout, capture/recheck, refunds, saved-method revocation and
  normalized provider events. Currency conversion is exact for supported ISO
  minor exponents and never uses floating-point money.
- Stripe verifies the exact raw body against rotating webhook secrets, accepts
  any valid `v1` signature and bounds timestamp age. PayPal delegates signature
  proof to its official verification endpoint using the transmitted headers.
- The HTTP boundary caps bodies at 1 MiB. The database stores only unique event
  IDs, SHA-256 digests and normalized evidence: never raw bodies, signatures,
  payer payloads or credentials. Early events receive a retryable response;
  duplicates cannot move money twice.
- Provider amount/currency disagreement and competing overpayment are refused.
  Payment, refund and dispute transitions serialize through the existing
  invoice ledger. Late events cannot roll saved methods or disputes backward.
- Saved methods require provider-hosted consent and expose only masked
  projections. Contact merge/undo and privacy export/erasure cover provider
  customers and method evidence without exposing tokens.
- `/admin/payments` gives authorized staff provider readiness, offline payment,
  refund, unsettled-checkout recovery, dispute visibility and saved-method
  revocation in English, French and Spanish. Money-moving actions use step-up
  and explicit confirmation.
- Additive migration `0046_right_swordsman.sql` adds provider customers,
  methods, disputes and digest-only event receipts plus the nullable checkout
  reference. Operator guidance is `deploy/commerce-payments.md`; release note
  is `.changeset/commerce-payment-providers.md`.

## C5.06 local evidence

- Focused provider/invoicing/registry/merge/doctor gate: 7 files and 46
  tests passed.
- `pnpm typecheck` and `pnpm lint` passed.
- `pnpm build` passed in 73.7 seconds; the known optional
  `@replit/object-storage` warning remains.
- All five production-build Chromium journeys passed serially in 52.1 seconds.
  The main journey recorded a CAD 100.00 owner-attested payment, issued a CAD
  5.00 partial refund, asserted both ledger rows and scanned the payment console
  for WCAG A/AA.
- The first complete Vitest pass reached 98/99 files and 1,147/1,148 tests; one
  unrelated mail permission test exceeded its five-second timeout under the
  19-minute concurrent database load. Its entire file then passed 9/9 in 12.8
  seconds in isolation. Protected-branch CI remains the authoritative clean
  full-suite rerun.
- Provider tests use deterministic mocked HTTPS. No live, sandbox or billable
  Stripe/PayPal call was made; the credentialed sandbox checklist is in the
  operator guide.

## C5.07 provider-parity checkpoint delivered behavior

- The identical payment contract now installs Square, Mollie, Razorpay,
  Paystack and Flutterwave beside Stripe and PayPal. One shared provider tuple
  drives config validation, service inputs, reconciliation, webhook routes and
  admin behavior so those surfaces cannot silently drift.
- Square uses idempotent Payment Links, order/tender rechecks, provider refunds
  and its exact notification-URL-plus-raw-body HMAC with current/previous key
  rotation. Payment events join by Square order before settlement changes the
  local provider reference to the Square payment ID.
- Mollie creates decimal-string hosted payments and refunds. Its recommended
  classic callback is authenticated by fetching the named `tr_` resource
  through the private API before any state is trusted; next-generation events
  additionally support rotating exact-body SHA-256 signatures.
- Razorpay recovers a Payment Link by a deterministic 40-character unique
  reference before create, verifies rotating raw-body signatures, and
  normalizes Payment Link, refund and open/won/lost dispute events.
- Paystack keeps its deterministic transaction reference as the safe provider
  identity, verifies it through the Transaction API, supports refunds and
  authenticates exact webhook bytes with SHA-512. Unsafe large JSON numeric IDs
  are never coerced into ledger references.
- Flutterwave Standard uses a deterministic transaction reference and verifies
  a signed successful webhook again through `verify_by_reference` before
  settlement. Refunds require the verified provider transaction ID; plain
  `completed` remains pending until a rail-specific terminal state.
- Only adapters with implemented reusable-method behavior advertise saved
  methods. All five new adapters explicitly keep subscriptions, payouts and
  in-person behavior off; Razorpay alone advertises dispute convergence among
  the five. Unsupported save requests are refused before provider checkout.
- Every provider has a bounded raw-body route, readiness diagnostics, copyable
  environment names and operator guidance. No C5.07 migration was needed
  because C5.06 already stored generic provider text and normalized evidence.

## C5.07 local evidence

- Provider wire/signature suite: 14 tests passed, covering checkout, recheck,
  refunds and settlement/refund feedback for every new provider plus Mollie
  classic/next-gen authentication, Razorpay disputes, rotation and tampering.
- Focused provider/service/config/doctor gate: 4 files and 35 tests passed.
- Full `pnpm test`: 99 files and 1,155 tests passed in 853.78 seconds.
- `pnpm typecheck`, `pnpm lint`, `pnpm license:check`, `pnpm plan:check`,
  dependency audit and `git diff --check` passed.
- `pnpm build` passed with all seven provider routes in the manifest; the known
  optional `@replit/object-storage` warning remains.
- Tests used deterministic mocked HTTPS only. No live, sandbox or billable
  provider request was made. Protected CI remains the browser/Docker evidence.

## C5.08 advanced-money checkpoint delivered behavior

- Migration `0047_fantastic_miss_america.sql` adds ten normalized tables for
  customer balance journals, plans/installments/allocations, voluntary-payment
  terms, late-fee evidence, provider statement lines, payouts and payout-line
  matching. Amount, status, uniqueness, total and foreign-key invariants are
  database-backed.
- Deposits and balances are two linked invoices with independent tax evidence,
  due dates, immutable totals and numbering. Late fees likewise become linked
  invoices only after due date plus grace; fixed/PPM calculation and caps are
  snapshotted without editing the overdue invoice.
- Payment plans must equal the current outstanding balance. Every successful
  payment allocates oldest-due-first and can span installments; any number of
  partial payments can settle one invoice without no-op state-event failures.
- Tips and pay-what-you-want selections enforce snapshotted min/max terms and
  become normal invoices/payments. Attached voluntary money must stay on the
  same Contact and currency.
- Customer credit is per Contact/currency with an append-only signed-delta
  journal. Spend creates a provider `balance` Payment; refund creates a normal
  Refund and restores credit in the same transaction. The internal provider
  cannot be selected as an external checkout adapter.
- Provider payout tracking accepts generic statement observations and immutable
  signed gross/fee/net lines. Reconciliation requires a paid payout, the same
  provider/currency, unused lines and an exact net equal to the bank deposit.
  Stripe and Square signed payout webhooks converge automatically; late events
  cannot roll state backward and a later provider failure clears reconciliation.
- The translated payment console surfaces unreconciled payouts and unmatched
  provider lines. Generated API/MCP services expose all advanced workflows.
  Contact merge combines same-currency balances with exact safe undo; privacy
  export covers terms/journals and erasure redacts free text while retaining
  accounting evidence.
- The browser gate now launches the actual standalone production artifact and
  copies static assets plus migrations into its runtime, matching deployment
  packaging instead of invoking unsupported `next start`.

## C5.08 local evidence

- Focused advanced-money/adapter/provider/merge gate: 4 files, 30 tests passed.
- Full `pnpm test` reached 99/100 files and 1,162/1,163 tests; the sole failure
  was the known database-load class, a 10-second `locale-routing` setup timeout.
  That complete file passed 15/15 immediately in isolation in 19.71 seconds.
- `pnpm build` passed in 84.7 seconds; the known optional
  `@replit/object-storage` warning remains.
- The real production-build Chromium journey passed in 33.0 seconds, including
  the offline payment/refund server actions and WCAG A/AA scan.
- Focused TypeScript, lint, licensing, plan and diff gates passed. Protected CI
  remains the authoritative uncontended full-suite and Docker/image proof.
- Provider tests use signed deterministic fixtures only. No live, sandbox,
  billable or bank payout call was made.
- PR #101 protected CI `31851161650`, post-merge CI `31851819756` and image
  publication `31851819702` passed; the landed merge is `b6b8665`.

## C5.09 product-lifecycle checkpoint delivered behavior

- The installed `catalog` module owns one Product identity for physical,
  digital, service, rental, bundle and pass kinds. Options, variants, pricing,
  inventory, booking and orders must attach to it in later C5/C6 work rather
  than create kind-specific catalogs.
- Migration `0048_marvelous_morg.sql` adds normalized `products` and append-only
  `product_lifecycle_events` with unique addresses, indexed lifecycle/kind/
  visibility/tax query paths and database checks for vocabulary, timestamps and
  positive optimistic versions.
- Draft activation requires an active tax category. Archive retains the row and
  requires a reason; restore returns only to draft. Kind locks after first
  activation, publication evidence survives archive/restore, and a changed
  published address creates a permanent normal SEO redirect.
- Public lists contain active/public products only. Exact resolution admits
  active unlisted products and admits member-only products only to authenticated
  actors; drafts and archived products never leak through public projections.
- Every write compares a version. Concurrent writers cannot overwrite each
  other, product-description autosaves serialize, and an editor preserved over
  a lifecycle refresh accepts a newer server token without rolling backward.
- Product descriptions are validated CMS block trees rendered by the real
  responsive preview. Unknown block vocabulary is refused before storage.
- `/admin/products`, `/admin/products/new`, `/admin/products/[id]` and
  `/preview/product/[id]` provide translated list/filter, create, edit, preview,
  activate, archive, restore and lifecycle-history operations in English,
  French and Spanish. Catalog grants govern the UI and the identical generated
  HTTP/MCP services.
- `MASTER.md` now explicitly requires admin workspaces for products/pricing,
  orders, inventory/purchasing, fulfillment/returns, payments/refunds,
  calendars/availability and appointments/waitlists before their milestones
  may be checked.

## C5.09 local evidence

- Focused catalog/i18n/registry/role gate: 4 files and 32 tests passed; the
  catalog suite's 5 database tests cover all six kinds, visibility, activation,
  invalid blocks, database constraints, permissions, redirects, concurrent
  writes and archive/restore history.
- Uncontested `pnpm test`: 101 files and 1,171 tests passed in 957.46 seconds.
  An earlier run exceeded its 20-minute shell ceiling and left its child worker
  alive; those exact test processes were stopped before this clean rerun.
- `pnpm build` passed with the new admin and preview routes; the known optional
  `@replit/object-storage` warning remains.
- The complete production-build Chromium journey passed in 36.5 seconds after
  creating and activating a service product, exercising rapid description
  autosaves, and scanning the product workspace for WCAG A/AA.
- TypeScript, lint, licensing, dependency, localization, plan and diff gates
  passed. Operator guidance is `deploy/commerce-catalog.md`; release note is
  `.changeset/commerce-product-lifecycle.md`.
- PR #102 protected CI `31856074057` passed in 10m48s. Post-merge CI
  `31856575007` passed in 11m44s and image publication `31856574998` passed;
  the landed merge is `340aa8e`.

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

## Earlier C1.26 baseline evidence

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
2. Build C5.10 option dimensions and safe generated variant matrices on the
   completed C5.09 product lifecycle.
3. Continue attributes, relations and pricing, then inventory/shipping and
   carts/checkout/orders;
   every mutation remains one service-layer transaction and every customer
   reference joins the existing Contact spine.
4. Check a C5 item only after its migrations, services, user surface, hostile
   and concurrency coverage, operator docs, changeset and full gates exist.

## Exact C5.10 restart packet

1. Start from updated protected `main`, verify the C5.09 baseline is present,
   and create `feat/commerce-variant-matrices`. Keep C5.04 separately visible;
   do not mark it complete without jurisdiction-correct template coverage.
2. Extend the installed `catalog` module and its existing Product identity.
   Do not create a second catalog or kind-specific product/variant tables.
3. Add normalized option types, option values, reusable dimensions, product
   assignments and variants through the next additive migration (`0049_*`).
   Preserve stable identities across regeneration and enforce SKU-fragment and
   default invariants in both services and PostgreSQL where practical.
4. Make matrix generation a previewable, deterministic reconciliation: clearly
   distinguish additions, retained combinations and removals; never silently
   destroy a variant that later commerce records could reference. Every write
   must use the C5.09 optimistic product version and one transaction.
5. Put the complete translated, permission-scoped operator flow in the existing
   `/admin/products` workspace. Admin, generated HTTP and MCP operations must
   call the same catalog services. Include empty, invalid, collision, stale-
   writer, concurrent regeneration and archive/restore cases.
6. Update `deploy/commerce-catalog.md`, add one C5.10 Changeset, record precise
   evidence in `MASTER.md`, and run focused database/concurrency tests followed
   by typecheck, lint, licensing, dependency, plan, changeset/schema gates,
   production build, Chromium/WCAG journey and the full test suite.

## Admin work still required

The admin requirement is explicit in `MASTER.md`, not an informal intention.
The completed surfaces are the translated `/admin/products` product lifecycle
workspace and `/admin/payments` payment, refund, recovery, dispute, saved-method
and payout-attention workspace. Upcoming milestones remain incomplete until the
same service-layer operations also have translated, permission-scoped admin
workspaces for:

- option matrices and pricing inside the catalog;
- customer orders and order-state operations;
- inventory, purchasing, counts, adjustments, transfers and receiving;
- fulfillment, shipments, returns/RMAs, restocking and refund convergence;
- calendars, availability, capacity and blackout management; and
- appointments, rescheduling, cancellations and waitlists.

The public storefront is not a substitute for these operator surfaces. Public
catalog, cart and checkout work arrives later in C5 and must consume the same
services rather than introduce parallel mutations.

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
