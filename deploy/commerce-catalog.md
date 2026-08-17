# Commerce catalog operations

Freeholder's `catalog` module owns the shared identity and lifecycle of every
thing a business sells. Physical goods, downloads, services, rentals, bundles
and passes are kinds of one Product; later option, price, inventory, booking and
order records attach to that row instead of creating parallel catalogs.

C5.09 established product lifecycle and the owner workspace. C5.10 adds reusable option dimensions and generated variant matrices. C5.11
adds attributes, comparison and unlimited ordered media with variant swaps.
C5.13 adds customer groups and currency-locked price lists. C5.12 adds
relations and bundle quotes. C5.14 adds volume and tiered quantity breaks on
the same resolver. C5.15 adds service offerings, cancellation policies,
intake-form attachment and payment-mode rules on `service` products.
Calendars, waiver templates and public product pages still arrive in C6 and
C5.04/C2.21. C5.16 is the ledger at `/admin/inventory`. C5.17 is
procurement at `/admin/procurement`. C5.18 is shipping quotes at
`/admin/shipping`. C5.20 carts live at `/admin/carts`. C5.21 checkout and
C5.22 orders live at `/admin/orders`; payment stays on the invoice.
Shipments and returns are C5.19 at `/admin/fulfillment` and `/admin/returns`.
Coupons, gift cards and cart offers are C5.23 at `/admin/promotions`.

## Admin workspace

Authorized staff use `/admin/products` to create reusable option types and
values, assign dimensions to a product, preview the generated matrix, apply a
reconciliation that archives unused combinations instead of deleting them, and
choose a default variant.

Authorized staff also use `/admin/products` to:

- filter products by lifecycle, kind and visibility;
- create drafts for all six product kinds;
- edit the name, stable product address, subtitle, brand, visibility, tax
  category and SEO overrides;
- build the description from the same validated content blocks and real
  responsive preview used by the CMS;
- activate a tax-configured draft, archive without deletion, restore only to
  draft, and read the append-only lifecycle history.

The workspace is translated in English, French and Spanish. `catalog` view
access reads products and history; `catalog` manage access performs mutations.
Owners retain wildcard manage access, administrators receive catalog manage
access, and the legacy staff compatibility role receives view access through
the default-role seeding path. Custom roles can grant either level normally.

Admin forms call `catalog.*` services. Generated HTTP and MCP projections use
the same definitions, validation, permission checks, transactions, audit rows
and events. No route writes product tables directly.

## Lifecycle and visibility

```text
draft -> active -> archived
  \-------> archived -> draft
```

- Every product begins as `draft` at version 1.
- Activation requires an existing active tax category. This prevents an item
  from becoming available with ambiguous tax treatment.
- Archive is reversible but requires a reason. Archived products are read-only
  until explicitly restored to draft.
- Restore never jumps directly to active; the owner reviews and activates it
  again.
- The first publication timestamp survives archive/restore. Once first
  activated, `kind` is immutable so orders, inventory and booking records can
  never have their meaning changed underneath them.
- Every write compares an expected integer version. Stale admin tabs, API
  clients and agents receive a conflict rather than silently overwriting a
  newer change. Description autosaves are serialized and advance the same
  token.
- Renaming the address after first activation records a permanent redirect from
  `/products/<old>` to `/products/<new>` in the normal SEO redirect table.

Visibility is independent of lifecycle:

- `public`: included in the public catalog projection.
- `unlisted`: omitted from lists but resolvable by its exact address.
- `member_only`: resolvable only for an authenticated actor.

Only active products reach any public projection. Draft and archived rows stay
owner-visible only. The storefront routes themselves remain a later catalog/
checkout milestone.

## Data and migration

Migration `0048_marvelous_morg.sql` adds:

- `products`: normalized identity, kind, validated description blocks,
  lifecycle/visibility, tax category, SEO, timestamps and optimistic version;
- `product_lifecycle_events`: append-only actor, prior/resulting state,
  visibility, version, reason and timestamp evidence.

The database independently checks kind, status, visibility, schema type, slug,
lifecycle timestamps and positive versions. Product slug is unique. Every
foreign key and admin/public query pattern has a matching index.

The migration is additive. Incident rollback is application-first: deploy the
previous application and retain the catalog tables. Do not drop owner product
content or lifecycle evidence. Backup/restore, ownership export and test cleanup
discover both tables through the module manifest.

## Verification

Run the focused gate with a migrated test database:

```sh
pnpm exec vitest run tests/core/catalog.test.ts tests/core/i18n-gate.test.ts tests/core/registry-completeness.test.ts tests/core/roles.test.ts
pnpm typecheck
pnpm lint
pnpm build
pnpm test:journeys
```

The catalog suite proves all six kinds, visibility projections, activation
interlocks, validated block vocabulary, post-publication kind immutability,
redirect-safe renames, exact archive/restore history, permission boundaries,
database checks and concurrent stale-write refusal. The Chromium journey uses
the production standalone artifact and scans the product workspace for WCAG
A/AA violations.
