# Commerce catalog operations

Freeholder's `catalog` module owns the shared identity and lifecycle of every
thing a business sells. Physical goods, downloads, services, rentals, bundles
and passes are kinds of one Product; later option, price, inventory, booking and
order records attach to that row instead of creating parallel catalogs.

C5.09 establishes product lifecycle and the owner workspace. It does not yet
claim variant matrices, prices, stock, public product pages, cart or checkout;
those arrive in C5.10-C5.21 and must use these product IDs.

## Admin workspace

Authorized staff use `/admin/products` to:

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
