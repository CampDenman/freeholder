---
"freeholder": patch
---

Four defects reported by a third party who built two sites on Freeholder and
deployed one to DigitalOcean:

- Link previews and short links were swallowed by the locale prefix. `/og/services`
  is shaped exactly like `/fr/services`, so the edge stripped the first segment
  and the request arrived as `/services` — every page's preview image 404ed when
  shared to Facebook, iMessage or WhatsApp, and every `/go/…` short link broke the
  same way. Two-letter route roots are no longer read as languages, and a test
  fails if a new one is added without being listed.
- Renditions stopped one step below the original when its width landed exactly on
  the ladder. A 1600-wide photograph got 400 and 800 and nothing else, so
  full-width heroes were upscaled by the browser; on the site this came from, 62
  of 185 originals were exactly 1600 wide.
- Connections are now bounded by `DATABASE_POOL_MAX`, defaulting to 4 per pool.
  An idle instance held 21 connections and DigitalOcean's smallest managed
  Postgres allows 22, so the second deploy could not connect at all. `PGMAX` could
  not fix it: postgres.js reads it but keeps it a string, and spreading a string
  length gives a one-connection pool.
- A plugin that cannot be wired now fails readiness and is logged. A disable used
  to be recorded only as a decoration on the module name, so it counted as a
  booted module, `/api/health` answered ok, and the platform promoted a broken
  instance over the healthy one it was replacing — 36 routes short, with nothing
  in the logs. `/api/health` reports a `disabled` count.
