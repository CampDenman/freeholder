# Freeholder — Roadmap

How the spec in `MASTER.md` becomes a shipped platform, in the order it gets
built and with the reason for that order written down.

`MASTER.md` is ground truth for *what* Freeholder is. This file is the plan for
*when*, and it is the shorter-lived of the two: phases are struck out as they
land, and anything that turns out to be wrong is corrected here rather than
argued about twice. `PROJECT_BACKLOG.json` records what each build session
actually delivered; this records what is still owed.

---

## Where the project stands (2026-07-30)

The spine is real and the product is not started. `main` is green on every
gate — license headers, dependency audit, type-aware lint, typecheck, tests,
build, and a Docker image proved to answer a real request.

**Built:** the service registry and its invariants (§11), the contact spine
(§4.1), session auth, business settings and module toggles (§4.8), the HTTP
edge with CSRF, the Bench design system with light and dark as equals (§32
tokens), a three-step setup wizard (§13 steps 1–3), the admin shell with
contacts and settings, storage adapters (§12), and a DigitalOcean droplet
recipe publishing to GHCR (§21b).

**Not started:** every one of the 23 feature modules in §3. `src/modules/` is
an empty directory. So are `src/mcp/` and `seed/`. Of the eight adapter
families in §12, only storage exists.

Against the §7 build order: step 1 is roughly half done, steps 2–10 are not
begun beyond the admin shell.

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
- **The §15.2 SEO gate and §15.7 a11y smoke in CI.**
- **`forms`** — submissions reaching the spine through `contacts.resolve` and
  `ctx.callAsSystem`, with the honeypot and time-trap anti-spam of §36.
- **`analytics`** — first-party pageviews and funnel events joined to contacts.
- **Locale routing middleware** and `EntityTranslation`, completing §4.9.

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

Then `invoicing` + `payments` (Stripe adapter, webhook verification) →
`catalog` → `cart-checkout` → `orders`, with the §4.3 state machines enforced
in the service layer, and the Canadian and EU tax-zone templates of §8.

## Phase 6 — the rest of v1

`booking` with Google Calendar sync → `quotes` and `contracts` → `galleries` →
`portal` → `email-marketing` (needs the mail adapters and §30's `Newsletter`
and `EmailTemplate`) → `reviews`.

## Phase 7 — the moat (§37)

`adapters/agent`, the two-lane builder, proposal previews, the plugin-PR lane,
budget accounting, `/source` for AGPL compliance, and `builder.*` as an
`ApiKey` scope granted separately from everything else.

---

## Threaded through every phase

- **Deploy recipes.** The Replit recipe is Tier 1 in §19 and does not exist
  yet. `migrate.md` per §18, the recipe validation matrix, and the §23
  round-trip test all follow it.
- **`packages/`.** `create-freeholder` and `templates` are scaffolds;
  `templates` should adopt the Bench tokens as its first theme.
- **Plugins (§24–27).** After the module contract has three or four real users,
  never before — a plugin API generalised from one example generalises the
  example's accidents.
