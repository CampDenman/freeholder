---
"freeholder": patch
---

Product collections — the taxonomy layer the C3.24 parity mapping proved missing (C3.25 slice 1). `collections` + `collection_products` tables (migration `0020_collections.sql`): manual collections curated and ordered by the owner, or segment collections whose membership the hourly job re-derives from one saved segment's paid orders through the core segments engine. Trash/restore/purge per the C11.14 family (a removed collection never touches its products), slug uniqueness with permanent redirects on rename, `catalog.listProducts` gains a `collectionId` filter, and published collections render at `/c/<slug>` with pagination, full hreflang, sitemap entries and CollectionPage + ItemList JSON-LD. Admin: `/admin/collections` list/editor and collection assignment on the product page. Locales en/fr/es/ar.
