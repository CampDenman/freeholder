# app/ — Next.js App Router (AGPL-3.0-only)

The thin routing layer over `src/`. Route groups per `MASTER.md` §10:

- `(public)/` — the server-rendered public surface (THE SEO surface)
- `(preview)/` — isolated editor previews
- `(admin)/admin/` — admin app (noindex); `(admin)/invite/` is the public,
  noindex staff-invitation acceptance door
- `setup/` — first-boot owner/business/location flow
- `api/` — HTTP RPC/API routes, thin wrappers over `src/` services

The customer portal is a completion target in `MASTER.md` C8.07–C8.08; it is
not present yet.

Rule: no business logic here, ever — route handlers call the service layer.
No framework imports below `app/` (lint-enforced in CI).
