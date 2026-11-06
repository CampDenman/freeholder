<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Link in bio (C9.39)

One page for the link in every social profile, on the business's own site.
`MASTER.md` §1 names "a link-in-bio" in the rented stack Freeholder replaces;
this is that replacement. The plan item and its evidence are C9.39 in §43.

## What it is

- **A CMS page with one `linkInBio` block.** Not a second content system: the
  page has the address, title, description, social card, canonical tag,
  hreflang, revisions, translations, approval and publish flow every page has.
  `linkinbio.setup` creates it at `/links` (any slug works, and renaming it
  later leaves a redirect like any page).
- **The block** draws a picture (an image from the media library, else the
  site logo, else a monogram), the name as the page's H1 (the business name
  when left blank), a short bio, the ordered links and a row of social icons.
  It is mobile first and server rendered; there is no client JavaScript.
- **Links** have a label, a kind, a destination, a hidden switch and an
  optional start and end. Kinds:

  | Kind | Destination stored | Public address | Shown while |
  |---|---|---|---|
  | `url` | `https://…`, `http://…`, `mailto:` or `tel:` | that address | always |
  | `page` | the page's path, e.g. `services/weddings` | `/services/weddings` | the page is published |
  | `product` | `products/<slug>` (a bare slug is accepted) | `/products/<slug>` | the product page is published |
  | `event` | `events/<slug>` (a bare slug is accepted) | `/events/<slug>` | the event page is published |
  | `newsletter` | `newsletters` or `newsletters/<issue>` | the archive with its sign-up form | that page is published |
  | `gallery` | the gallery slug | `/g/<slug>` (its own lock screen) | the gallery exists and has not expired |
  | `booking` | a bookable service's product id | `/book?service=<id>` | the service is bookable |

  A smart link whose destination goes away is left out of the page, not sent
  to a 404, and the admin screen and `linkinbio.page` say `unavailable`.
- **Scheduling** is read in the business's time zone. The editor and the
  admin screen take a local date and time; the API also accepts a date
  (`2026-12-31`, which as an end means "through that day") or an exact time
  with an offset. The public route renders per request, so a scheduled link
  appears and disappears on time without a publish.
- **Design.** Three button styles — solid, outline, soft — each built only
  from token pairings the token tests and the design service guarantee
  (`onAccent` on `accent`; `ink` on `surface` / `surfaceMuted`; `ruleStrong`
  edges), so WCAG AA holds in light and dark for any palette an owner can
  save. The page template `page.link-in-bio` is the optional preset in
  Templates.

## Clicks and privacy

Every rendered link points at `/go/link/<id>?from=<page>`. The route hands the
id to `linkinbio.follow`, which looks the link up **on the published page**
and redirects (302, `no-store`, `noindex`) to the stored destination — never
to anything in the request, so it is not an open redirect. A click whose
`from` was lost is looked up on the site's other published link-in-bio pages.
Hidden, expired, unavailable and unknown links all answer 404 alike.
`robots.txt` disallows `/go/` (this and the ad click-out), so crawlers neither
inflate the counts nor treat a redirect as a page.

A click is one `linkinbio.clicked` event written through `analytics.track`,
only when the visitor's analytics consent policy allows identifiers, never on
the playground or for a prefetch, deduplicated per visitor and link per
minute, and classified human/bot like every page view. There is no click
column and no third-party tracker. `linkinbio.report` reads clicks and unique
visitors back through `analytics.eventTotals`; for on-site destinations the
redirect adds `utm_source=bio&utm_medium=link-in-bio&utm_campaign=bio:<id>`,
so visits and form conversions after the click come from
`analytics.campaignTotals`. Visitors who declined analytics are not counted,
as everywhere else. Social icons link straight to the profile (with
`rel="me"`) so identity verification works; they are not counted.

## Surfaces and permissions

| Surface | Where |
|---|---|
| Admin | `/admin/link-in-bio` (Marketing → Link in bio); the visual editor at `/admin/pages/<id>` edits the same block |
| HTTP | `/api/v1/linkinbio.*` (`page`, `setup`, `addLink`, `updateLink`, `setLinkHidden`, `scheduleLink`, `reorderLinks`, `removeLink`, `updateProfile`, `targets`, `report`; `follow` is public) |
| MCP | `linkinbio_*`, generated from the same services |

Every edit is a page edit: the services compose `cms.updatePage` and
`cms.publishPage` as the caller. A person needs the `linkinbio` grant and the
`cms` grant; an API key needs `linkinbio.*` (or the named service) **and** the
CMS page services it composes (`cms.*`, or `cms.getPage`, `cms.updatePage`,
`cms.detachLayout`, `cms.publishPage`). Each edit writes a `linkinbio.*`
audit row, the `cms.updatePage` row beside it and a page revision, so the
editor's history can restore any earlier set of links. `removeLink` is
`destructive` (approval-gated for agents) and needs `confirm: true`.

A link edit goes live only when it cannot publish anything else: the page is
already published, has no other unpublished edits and is not awaiting
approval. Otherwise it is saved to the draft and the response's
`publication.pending` says why (`draftPage`, `unpublishedEdits`,
`awaitingApproval`, or `notRequested` when `publish: false`).

## Linking to it

The page is in the sitemap like any published page, so link to it from the
site itself (the footer is the usual place). A page that only social
profiles point at is an orphan to a crawler, and the SEO gate reports
"in the sitemap but no page links to it". The demo links it from its footer.

## Demo

The Aurora Coast sample site installs `/links` with a booking, an event, a
product, two pages and the newsletter sign-up, all smart links
(`seed/demo/content.ts`, `LINK_IN_BIO`).

## Not included

- No custom domain or short domain for the page itself: it is a page on the
  site's own domain.
- No page-level "hide the site header and footer" mode; the page renders
  inside the site's chrome like every page.
- No thumbnails or embedded media per link, no per-link custom colours, no
  tip jar or sensitive-content gate on the block (the existing tip, paywall and
  newsletter blocks can sit on the same page).
- No UTM parameters added to outside addresses, and no click counts for social
  icons (see above).
- No click-through rate on the screen: page views are in Traffic, clicks are
  here.
