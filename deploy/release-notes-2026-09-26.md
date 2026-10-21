<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-26

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Plan gate at this snapshot: **297 unique IDs, 270 checked,
27 open**. Refresh GitHub before treating anything below as shipped.

Two themes ran through this session. The first was closing C6.11 and getting the
C11.11 harness to run at all. The second was a set of defects reported by a
third party who built two sites on Freeholder and deployed one to DigitalOcean —
**23 of their 24 findings were reproduced exactly as described**, and most of
them were in code this checklist already counted as complete.

## Security — `forms.get` disclosed notification addresses (#412)

`forms.get` is `permission: "public"` and returned the whole form row, so any
unauthenticated caller could read `notify`: the addresses a site's form
submissions are e-mailed to. No session, cookie or key needed, and `contact` is
the obvious slug to guess, so the addresses were harvestable across instances.
The reporter confirmed it on two sites and did not disclose it publicly.

The intent was already documented and only the query disagreed — the comment
above `forms.get` said "deliberately thin", and `forms.byId` below it describes
`notify` as a column "a visitor never sees". `forms.get` now has its own named
projection in both its output schema and its query, so the column never leaves
the database and a column added to the table later cannot leak the same way.
Sending is unaffected; the submit path reads `notify` through its own query.

**An existing test had been asserting this against the wrong service.** "is not
a way for a visitor to read who gets notified" tested `forms.byId`, which refuses
anonymous callers outright, so it passed while the service a stranger can
actually reach was never checked. The new test calls `forms.get` as `ANONYMOUS`,
asserts `notify` is *absent* rather than empty, and confirms staff can still read
it. Verified failing against the previous service.

Owners on existing instances should assume the addresses on any site with a
public form were readable and decide whether that warrants a notification.

## Owner-authored truth — C8.14, C8.15, C8.16, C5.26, C6.18 (#411)

Five capabilities, each built to the full F01–F12 bar, so an industry starter can
be assembled from Freeholder rather than forked from it:

- **Guided assessments** (C8.14) — owner-authored questions, scored bands and
  per-answer escalations. `assessment_responses.band_id` is `NOT NULL` with
  `RESTRICT`, so an unauthored outcome is unrepresentable, and
  `assessment_bands_no_overlap` (`EXCLUDE USING gist`) makes two bands over one
  score impossible.
- **As-of dated published facts** (C8.15) with a correction ledger. A partial
  unique index over `COALESCE`d subject columns allows exactly one current fact
  per key and subject, so a business-wide figure is not exempt, and a second
  index stops the ledger forking.
- **Consent-gated progress media** (C8.16) — an append-only consent ledger
  ordered by effect time, so late data entry cannot reinstate a withdrawal, plus
  an hourly sweep that takes published work offline the moment its permission
  stops standing. This replaced a real pre-existing defect:
  `projects.revokeConsent` nulled three columns, destroying the proof that
  publication had been lawful.
- **Owner-configured calculators** (C5.26) over a closed vocabulary — seven
  operations and three operand kinds, no expression parsing and nothing
  evaluated, so configuring arithmetic is not a way to run code. `compute`
  **refuses** when a fact is missing or stale rather than falling back to the
  last number it saw.
- **Enforced coverage checks** (C6.18) that answer `covered`, `outside` or
  `unconfirmed`, and never claim coverage from a radius or a named region.

## C6.11 closed — events and classes (#414)

The `events` module was already built: venue, sessions with capacity, ticket
types, waitlists that promote the oldest fitting seat on cancel, check-in, Event
JSON-LD wired into the public renderer, ICS and both surfaces. Three things kept
the item honestly open, and all three are now closed.

Nobody had ever looked at it in a browser, so F06's axe pass over the public and
admin surfaces had never run in either theme. `tests/browser/events.spec.ts`
asserts what only a browser can: a visitor finds the class from the index, a
sold-out session reads `0 / 2 seats` rather than going quiet — silence reads as
availability, which is the reading that wastes somebody's trip — the calendar
link returns real `text/calendar` with a `VEVENT`, and a draft event is absent
from the index. It passed on its first CI execution.

It shipped no demo fixture; there is now a demo class in en/fr/es whose verify
requires the event to be published **and** to have a session, because a class
with no date is not one anybody could attend.

**Its evidence line cited a migration that does not exist.** It named
`0059_concerned_sumo.sql`, which the migration squash removed — the tables are in
`0000_reviewed-baseline.sql`. Since the plan gate requires every backticked path
in a checked item to resolve, C6.11 could not have been ticked as written however
finished the software was. An audit of the other open items found no second
instance: **C6.11 was the only item blocked by a stale citation**, so the
remaining work is genuine.

## C11.11 could not run on the owner's platform (#415)

`scripts/performance-budgets.mjs` shelled out to `pnpm exec vitest`. On Windows
there is no bare `pnpm` for `spawnSync` to execute, and naming `pnpm.cmd` is
refused with `EINVAL` because Node will not spawn a `.cmd` without a shell — so
the harness exited before measuring anything. C11.11 asks the product owner to
produce the reference-target acceptance evidence, and a gate that only runs on
the CI image is not a gate anybody can sign. Vitest now runs under
`process.execPath`, with no package manager involved on any platform.

First measurements on the owner's machine (`win32 · 12 CPUs · 16GB`), all three
datasets passing and exiting 0:

| Surface | small | medium | Budget |
|---|---|---|---|
| Admin list (any) | 3.8ms | 4.3ms | ≤ 800ms p95 |
| Admin detail | 1.6ms | 2.3ms | ≤ 1s p95 |
| Search | 3.2ms | 29.2ms | ≤ 500ms p95 |
| Report generation | 2.5ms | 5.2ms | ≤ 5s p95 |
| Public page, server render | 3.9ms | 4.1ms | ≤ 300ms p95 |

Fixture counts verified by the harness at medium: 5,000 contacts, 20,000
messages, 2,000 orders, 500 products, 10,000 assets. Large seeds 100,000
contacts and took 59s.

**C11.11 stays open.** The browser Core Web Vitals, editor, job-queue, migration
and cold-boot families are opt-in and have not run, and these numbers come from a
development machine, not the reference target. The harness prints a run header
precisely so a diagnostic run cannot be mistaken for acceptance.

## Third-party findings — 13 of 24 fixed

Merged in #413: link previews and short links were swallowed by the locale
prefix, because `/og/services` is shaped exactly like `/fr/services` and the edge
stripped the segment. Every page's preview image 404ed when shared, and `/go/…`
broke identically — invisible on the site itself, visible only when a shared page
comes back blank. The reporter's suggested fix would not have worked:
`NEVER_LOCALIZED` is tested against the *rest* of the path, so it answers "is
`/admin` localizable" and never "is `og` a language". A test now enumerates
`app/` and fails if a two-letter route appears unlisted.

Also in #413: image renditions stopped one step below an original landing exactly
on the ladder, so a 1600px photograph produced 400 and 800 only and full-width
heroes were browser-upscaled (62 of 185 originals on the reporting site were
exactly 1600 wide); `DATABASE_POOL_MAX` now bounds connections, because an idle
instance held 21 against DigitalOcean's 22-connection limit and the second deploy
could not connect at all; and a plugin that cannot be wired now fails readiness
and is logged, where previously it counted as a booted module, `/api/health`
answered ok, and the platform promoted a broken instance over the healthy one it
was replacing — 36 routes short, with nothing in the logs.

`PGMAX` could not have fixed the pool: postgres.js reads it but leaves it a
**string**, and spreading a string's length yields a one-connection pool, so
every attempted workaround made throughput worse while looking like a fix. The
test asserts the *type*, not the value.

Open in the batch-2 PR: the web manifest named the platform rather than the
business on customers' home screens; there was no not-found route, so a mistyped
address rendered an empty body inside the site's own layout; `llms.txt` described
a Canadian business as "based in CA"; text controls were 14px, so iOS Safari
zoomed the page on every first tap into a field; `onDanger` was contrast-checked
but absent from the patch schema, so a site was refused over a role it had never
been allowed to send; a nav block can now opt out of collapsing behind a phone
menu, which had hidden every footer link on mobile; and `cms.ensureDefaults`
names the stale section instead of answering 500.

**Control borders now meet WCAG 1.4.11.** The `rule` token measures **1.17:1**
against every ground it borders — worse than the 1.3–1.8:1 estimated, and true of
the default palette, not only custom ones. Raising `rule` was not the fix: it
draws 828 hairlines and 60 of them are controls, so the fields would have been
corrected by darkening every divider in the interface. A separate `ruleStrong`
role (3.32:1 light, 3.41:1 dark) is checked on all four grounds in both schemes,
and 322 control borders across 86 files use it. Dividers keep the lighter token,
which is correct: 1.4.11 governs the edge of something you can operate.

### Still open from those reports

Media URLs re-signed every 900 seconds, so a photograph can never be cached and a
tab left open for fifteen minutes gets 403s on lazy-loaded images; local media
served with `private, max-age=300` and no `ETag`, `Last-Modified`, `Content-Length`
or `Range`; media that cannot be tagged, captioned, searched or listed publicly;
list rows that cannot hold an image picker, so a gallery is edited by pasting
UUIDs; plugin blocks that cannot declare the heading level they render, so a page
whose title lives in a hero fails the publish check; plugins not discovered from
`plugins/` although §25 describes folder auto-discovery; the `--fh-measure` cap on
header, footer and columns; and a form error that wipes every field and
identifies none.

Six deployment items also remain: the App Platform recipe still specifies a dev
database that cannot be migrated; no CA-certificate support, so the job runtime
cannot reach a DigitalOcean managed database over TLS; the nightly backup cron has
**never run once**, because `. /opt/freeholder/.env && …` sets shell variables
without exporting them to a child process and the failure goes to root's mail on a
box with no mail server; no bucket CORS step, so the first admin upload fails;
`www` unserved, because the Caddyfile has a single site block; and SMTP on 587,
which DigitalOcean blocks on droplets.

## Notes for whoever picks this up

Three tests were caught asserting the wrong thing this session: the `notify`
disclosure was tested against the service that refuses anonymous callers; a
journey test asserted Next's bare `404` heading, holding the missing not-found
route in place; and the C6.11 citation kept a finished item open. On this
codebase a passing test is not by itself evidence that the right subject was
tested.

CI also enforced two rules worth knowing before editing: route handlers never
reach the database directly (§15.5 — the first `app/manifest.ts` did, and lint
refused it), and the generated SDK is compared against a fresh run, so changing
any service's input or output schema means regenerating it.
