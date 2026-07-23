# app/ — Next.js App Router (AGPL-3.0-only)

The thin routing layer over `src/`. Route groups per `MASTER.md` §10:

- `(public)/` — the server-rendered public surface (THE SEO surface)
- `(portal)/portal/` — customer portal (noindex)
- `(admin)/admin/` — admin app (noindex)
- `api/` — REST routes, thin wrappers over `src/` services

Rule: no business logic here, ever — route handlers call the service layer.
No framework imports below `app/` (lint-enforced once CI lands).
Lands with build-order step 1 (`MASTER.md` §7).
