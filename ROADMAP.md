# Freeholder — Roadmap

How the spec in `MASTER.md` becomes a shipped platform, in the order it gets
built and with the reason for that order written down.

`MASTER.md` is ground truth for *what* Freeholder is. This file is the plan for
*when*, and it is the shorter-lived of the two: phases are struck out as they
land, and anything that turns out to be wrong is corrected here rather than
argued about twice. `PROJECT_BACKLOG.json` records what each build session
actually delivered; this records what is still owed.

---

## Where the project stands (2026-08-02)

`freeholder.ai` is a live Freeholder instance serving its own site from blocks
in its own database, over TLS, and it is now findable. `main` is green on every
gate — license headers, dependency audit, type-aware lint, typecheck, tests,
build, and a Docker image proved to answer a real request.

**Built:** the service registry and its invariants (§11), the contact spine
(§4.1), session auth, rate limiting and security headers, business settings and
module toggles (§4.8), the HTTP edge with CSRF, the Bench design system with
light and dark as equals (§32 tokens), a three-step setup wizard (§13 steps
1–3), the admin shell with contacts and settings, storage adapters (§12), a
DigitalOcean droplet recipe publishing to GHCR (§21b), `core/media` with sharp
renditions, the `cms` module with a **visual** block editor (canvas, inline
editing, drag), and `core/seo` (canonicals, JSON-LD, sitemaps, robots, llms.txt,
redirects on rename).

**Not started:** the money path, the scheduling engine, and everything that
depends on them. Of the module map in §3, `cms` is the only feature module.
`src/mcp/` and `seed/` are empty. Of the adapter families in §12, only storage
exists.

Against the §7 build order: step 1 is nearly done, step 6 is half done, and the
rest is ahead. §38 in MASTER.md is the checklist for what v1 "complete" means;
Phases 5 and 6 below are how it gets built.

---

## The one deliberate deviation from §7

**§7 lists the money path second. We are building the project's own website
first.** That decision was made on 2026-07-26 and has governed the work since;
it is recorded in MASTER.md §7 so that it stops living in session notes.

The short reason is that `freeholder.ai` needs settings, media, jobs, cms,
forms, seo, analytics and an admin shell — and none of commerce, booking,
quotes, galleries or the portal. It is about a fifth of v1 and it is the fifth
that has to exist before anyone can be told the project exists.

The longer reason is architectural, and it is the one that actually settles it.
§32 makes the public surface a block tree in the database — "structure is data;
code is vocabulary" — and §37, the moat, is built entirely on that line already
existing. The cms/blocks work is therefore not step 6 of a list; it is the
floor under the public surface, under the unresolved question of how a module
mounts a route in a file-system router, and under the self-building instance.
Building our own site builds that floor and dogfoods it on something real.

---

## Phase 0 — the compounding debts ✅

Landed 2026-07-30. Four items, each strictly cheaper then than at any later
point:

- **The i18n retrofit and the §15.3 gate.** `t()` was imported by nothing while
  ~2,400 lines of admin and setup UI hardcoded English. §2 principle 9 calls
  this the single most expensive refactor a platform can face, and the project
  was accumulating it by the PR. Every string now comes from a catalog, and a
  lint rule plus a catalog-completeness test stop it recurring.
- **The merge completeness gate.** `contacts.merge` repoints a hand-maintained
  FK list (CLAUDE.md non-negotiable). A schema-reflection test now fails when a
  `contact_id` column has no entry — before 23 modules start adding them.
- **Rate limiting, security headers, dependency audit.** Open across three
  backlog entries; §36 classes these as v1.0 gates rather than features.
- **`updated_at` and `contacts.resolve`.** The timestamp maintains itself now,
  and a returning form submission enriches a known contact instead of
  discarding what it said.

---

## Phase 1 — finish core (§7 step 1)

- **`core/media`** — `Asset`, variants via sharp (AVIF/WebP, responsive), the
  admin library, alt text. Unblocks cms blocks, galleries, logos and OG images;
  the storage adapters have had no consumer for two PRs.
- **`core/jobs`** — the pg-boss wrapper and job registry, mounted at boot, with
  the expired-session sweep as its first job. Then move the event bus onto a
  transactional outbox so a crash between commit and publish stops losing
  events.
- **`core/locations`** — NAP as a single source of truth with `renderNAP()`
  (§4.10), and setup wizard step 4.
- **OTP and password reset**, closing §9's auth spec and §13 step 1.
- **`scripts/doctor.ts`** — §17 calls doctor the contract that makes community
  recipes trustworthy. Every later phase adds checks to it.

## Phase 2 — the floor: cms and blocks (§32)

The largest single piece of work in the project, and the one to over-invest in.
Split in two, because the block *system* and the block *editor* are different
problems and only the first blocks everything else.

### Phase 2a — the block system ✅

Landed 2026-07-31.

- Typed, Zod-schema'd block nodes rendered by server components; `blocks`
  jsonb validated against the registry on every write, `ContentRevision` on
  every save.
- **Site chrome as Sections** — `app/(public)/layout.tsx` fetches two rows and
  renders them; it contains no site structure at all.
- **The module route-mounting decision**, resolved as §32 implies and written
  into MASTER.md §11: one catch-all public route, and a module reaches the
  public surface through block types, sitemap sources and seed content — never
  page routes.
- `cms` is also the first feature module, so this is where the §11 contract
  stopped being core describing itself: `requires` and the topo-sort, and a
  listener on core's `settings.setupCompleted` with neither module importing
  the other.

### Phase 2b — the editor ✅

Landed 2026-08-01.

- Edit forms **derived from each block's Zod schema**, so the editor knows
  about fields and never about individual blocks — which is what makes §24's
  zero-editor-changes promise for plugins real.
- Reorder by buttons *and* drag, autosave, version history with one-click
  restore, pages and chrome admin screens.
- **Not done, and named rather than implied:** slash-command insertion (§32
  names it, but it implies a rich-text surface the text block does not have —
  what shipped is a block picker) and dragging between nesting levels.

### Phase 2c — the visual canvas

The preview pane and click-to-select landed 2026-08-01, which is steps 1–2 of
the four that separate a form editor from a WYSIWYG one. What remains:

- ~~**Inline editing**~~ ✅ *(2026-08-02)* — heading text, body copy and button
  labels are typed straight onto the canvas. The canvas reports the keystroke;
  the editor applies it to the tree.
- ~~**Visual drag**~~ ✅ *(2026-08-02)* — a grip per block, drop indicators
  computed from rendered geometry, and movement in and out of containers. The
  legality of a move lives in a pure, tested function, not in the component.

**All four steps are done.** The editor is visual: you see the page, click it
to select, type into it, and drag its parts around.
- **Rich text** is a **spec decision before it is work**: §32 forbids markup
  blobs, so inline formatting needs a constrained inline-node schema rather
  than stored HTML. MASTER.md has to settle that first.

The canvas must stay a *view* of the tree — edits flow tree → render, never
render → tree. If the DOM ever becomes the source of truth, typed blocks,
migrations and re-theming all stop being true.
- Still deferred: per-entity layout overrides, variants with a traffic split,
  and the paywall gate — all of which the schema already leaves room for.

## Phase 3 — be found (§7 step 6, §5)

- ~~**`core/seo`**~~ ✅ *(2026-08-02)* — canonicals, Open Graph and Twitter
  cards, WebSite + Organization JSON-LD on the home page and BreadcrumbList
  elsewhere, a sitemap index over per-locale sitemaps assembled from module
  manifests, robots.txt, llms.txt, and automatic redirects on slug change.
  **Still owed here:** hreflang (waiting on the locale routing below — there is
  no second URL to point at yet), generated OG images, and the IndexNow ping.
- **`seed/`** — "Aurora Coast Photography". A prerequisite rather than a nicety:
  §15.2's SEO gate crawls the seeded demo site, and §25's plugin dev harness
  boots it.
- ~~**The §15.2 SEO gate and §15.7 a11y smoke in CI**~~ ✅ *(2026-08-03)* — the
  demo site is crawled from the root on every PR and the four public templates
  are audited with axe. What is still owed is a browser: focus order, focus
  visibility, keyboard traps and reflow are unchecked, and the gate now says so
  out loud rather than implying coverage it does not have.
- ~~**`forms`**~~ ✅ *(2026-08-03)* — submissions reach the spine through
  `contacts.resolve` and `ctx.callAsSystem`, with §36's honeypot and time trap
  and a quarantine queue rather than a bin. Also the first module to contribute
  a **block type**, which is the §24 seam plugins will use. Still owed: a form
  builder in the admin (forms are created through the service today), and
  notification email, which waits on a mail adapter.
- ~~**`analytics`**~~ ✅ *(2026-08-04)* — first-party page views recorded by the
  server rather than by a script, conversions collected on the bus without
  analytics and forms importing each other, and a visitor's history claimed
  onto the contact they turn out to be. The funnel stops at "became a contact"
  because the money tables do not exist yet; the rest is one join away. Still
  owed: a consent gate (§30 models it and nothing reads it), retention and
  pruning, and Core Web Vitals.
- ~~**Locale routing middleware** and `EntityTranslation`~~ ✅ *(2026-08-04)* —
  §4.9's URL strategy, translations as rows against the same page rather than
  duplicate pages, machine drafts excluded from the public surface, hreflang
  and per-locale sitemaps that advertise only what exists, and a language
  switcher block. **Still owed:** an admin surface for writing translations,
  translated site chrome, and `Contact.preferred_locale` reaching the customer
  surfaces that do not exist yet.

**freeholder.ai ships at the end of this phase.**

## Phase 4 — make it agent-operable (§7 step 9, pulled forward)

- **`src/mcp`** — tools generated from the service registry, built at boot from
  the enabled modules only.
- **REST API, `ApiKey` scopes, outbound webhooks**, and `/api/openapi.json`
  generated from the same Zod schemas that validate every request.
- **The §28 drift gate** and the generated `@freeholder/sdk`.

Pulled ahead of the money path on purpose. It is generation rather than
authoring, so it is cheap once the registry is stable; it makes everything
built afterwards agent-operable by existing; and §2 principle 7 is only true
once it does exist.

## Phase 5 — the money path (§7 steps 2–3)

Adapter interfaces and `none/` implementations for every remaining family land
at the head of this phase, so modules stop null-checking absent vendors.

Then, in dependency order:

- **`core/tax`** (§4.12) before anything charges anybody. Zones, categories,
  compound and sequential rates, registrations with threshold watching,
  exemptions and reverse charge, per-zone inclusive/exclusive display, and
  `TaxLine` snapshots. Templates for CA, EU, UK, US, AU and NZ. It comes first
  because an invoice built before tax exists gets tax bolted onto it, and that
  bolt is visible in the schema forever.
- **`invoicing` + `payments`** — Stripe adapter, webhook verification, the §4.3
  state machines enforced in the service layer.
- **`catalog`** (§4.2) — this is the big one. Option types and values, the
  generated variant matrix, attributes, `ProductMedia` with roles and per-
  variant swaps, price lists, and `PriceBreak` in both tiered and volume modes
  with a single deterministic resolver that can say *why* a price won.
- **`inventory`** — the `StockMovement` ledger, reservations with expiry,
  multi-location from the first migration, backorder policy per variant,
  back-in-stock subscriptions. Suppliers and purchase orders follow.
- **`shipping`** (§4.11) — zones, the rate engine, packaging and dimensional
  weight, split shipments, pickup and local delivery windows, returns.
- **`cart-checkout` → `orders`** — the two modules that turn all of the above
  into a purchase, plus bundles, upsells and abandoned-cart recovery.

**Why this order:** every later module prices something, and the price resolver
plus the tax engine are what "prices something" means. Building checkout first
would mean building it twice.

## Phase 6 — time, work, and the rest of v1

- **`core/scheduling`** (§4.4) — calendars for the business, each person and
  each resource; the availability resolver (buffers, lead time, horizon,
  capacity, compound requirements, assignment, travel time, caps); ICS feeds;
  the calendar adapter for two-way sync; and the exclusion constraint that
  makes double-booking impossible rather than unlikely.
- **`booking`** on top of it — waitlists, group capacity, deposits through the
  money path, cancellation policies, reschedule tokens, multi-channel
  reminders, intake forms and waivers as preconditions.
- **`rentals`** and **`events`**, which are the same engine pointed at a
  resource and at a seat count.
- **`quotes`** and **`contracts`** → **`portfolio`** (§4.5: projects, outcomes,
  before/after, testimonials) → **`galleries`** → **`portal`**.
- **`crm`** (§30) — deals, tasks, notes, segments, consent records, imports,
  the duplicate queue — and **`inbox`**, which is the spine made visible.
- **`core/messaging` + `inbox`** (§4.14) — numbers and their registration
  state, two-way SMS/MMS, consent per purpose, STOP/START/HELP handled before
  anything else sees a message, quiet hours in the recipient's timezone,
  delivery receipts and per-message cost. Inbound resolves to a `Contact`
  through `contacts.resolve`, so a text from an unknown number is a real person
  with a real timeline. Voice and video stay plugins.
- **`automations`**, then **`email-marketing`** (needs the mail adapters and
  §30's `Newsletter` and `EmailTemplate`) → **`reviews`**.
- **`affiliates` then `loyalty`** (§4.13), in that order and not the reverse:
  loyalty is the referral ledger seen from the other side, and building points
  first means building attribution twice. Ledger discipline, earn rules as
  listeners on spine events, tiers, rewards that redeem into the normal money
  path, holdbacks and reversal on refund, and the outstanding-points liability
  shown to the owner.
- **`subscriptions`** (§4.15) — plans, entitlements as the unit of access,
  hard/soft/metered paywalls with the SEO markup that matches the gate, dunning
  policies, proration, and portal self-service. It lands after `payments`
  because provider-run billing is most of it, and before `ads` because a
  publisher usually tries a membership before it tries a sponsor.
- **`ads`** (§4.16) — seeded IAB sizes per breakpoint, the slot block, house
  fill, sold campaigns invoiced through the money path, first-party impression,
  viewability, unique and click counting into analytics with a daily rollup,
  and consent-gated third-party creatives with generated `ads.txt`.
- **`reporting`** and the accounting export.

**Payment providers** (§12): Stripe, PayPal and manual/offline at 1.0; Square,
Mollie, Razorpay and Paystack/Flutterwave as first-party adapters after it,
chosen for the markets the first two serve worst. Methods — Apple Pay, Klarna,
iDEAL, SEPA, ACH — are surfaced by whichever provider is configured rather than
being adapters of their own.

§38 is the checklist for what "done" means here: it names the connective work
that makes a list of modules feel like a product rather than a suite.

## Phase 7 — the moat (§37)

`adapters/agent`, the two-lane builder, proposal previews, the plugin-PR lane,
budget accounting, `/source` for AGPL compliance, and `builder.*` as an
`ApiKey` scope granted separately from everything else.

---

## Staying current (§39) — earlier than its section number suggests

The self-update path is security infrastructure, not a late-stage feature: the
first non-Camp-Denman instance to go live starts accruing unpatched days
immediately. It lands in pieces, each cheap once its prerequisite exists:

1. **Signed images and provenance** (already a backlog item) — nothing else in
   §39 is safe to build before the artifact can be verified.
2. **The N-1 schema discipline and the two §15 gates** — the upgrade gate and
   the schema-compatibility gate. These cost almost nothing now, when there are
   five migrations, and cannot be retrofitted honestly later.
3. **`releases.json` and `freeholder update --check`** — after `core/jobs`,
   which the daily check needs, and alongside `scripts/doctor.ts`, which
   preflight extends rather than duplicates.
4. **Preflight with the shadow-database migration dry run**, then the applier
   with snapshot, smoke suite and automatic rollback.
5. **The admin surface, the MCP tools and the notification escalation** — last,
   because by then there is something true to report.

Steps 1 and 2 belong in the next few PRs regardless of what phase is running.

## Threaded through every phase

- **Deploy recipes.** The Replit recipe is Tier 1 in §19 and does not exist
  yet. `migrate.md` per §18, the recipe validation matrix, and the §23
  round-trip test all follow it.
- **`packages/`.** `create-freeholder` and `templates` are scaffolds;
  `templates` should adopt the Bench tokens as its first theme.
- **Plugins (§24–27).** After the module contract has three or four real users,
  never before — a plugin API generalised from one example generalises the
  example's accidents.
