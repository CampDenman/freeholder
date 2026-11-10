<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->
# Blog structure and WordPress migration qualification

Canonical work: MASTER §43 C2.27, C2.28, C2.29 and C3.46. These remain open until
review, release and deployed acceptance. C3.45 is implemented in a separate
preview-assistant branch; this change reserves its agreed checklist text only.

When replacing a live post, bylines, taxonomy and approved imported comments
stay staged until publication in the same transaction as the body cutover.
Rollback restores the prior publication date and working copy as well as post
metadata; an imported draft must be renamed when it collides with a live page.
Republishing an edit keeps the first publication date and updates the post’s
modified date. Registered publication vetoes also hide bylines, comment threads
and archives. A slug lookup must resolve to the exact selected page ID: a
public row in another locale cannot authorize a hidden duplicate. Ordinary-page
replacements remove the old blog marker only at cutover; comments reference
the underlying page so kind changes hide history without deleting rollback data.

The original WXR post permalink stays the CMS page address, including date
segments. Blog membership is explicit metadata, so the blog listing does not
require a move under `/blog`. Original imported search titles and descriptions
carry preservation flags; new composed titles keep the existing suggested
lengths. Supported Yoast/Rank Math title, description, canonical, noindex,
nofollow and social overrides carry across; same-source canonical addresses
are rebased to the new site. Reviewed Freeholder translations supply hreflang;
an export cannot establish which source translations were actually live.

Categories, tags and authors are real records with owner screens and scoped
services. Hierarchical WordPress category paths and guest author paths are
retained. Existing matching records are reused; an old archive alias points to
an existing archive when its path differs. Private author email is absent from
public bylines and archive responses. Public category navigation includes only
categories with published posts. Date archive and old `/page/N` links use the
same published listing and filters.

Reader comments use their own table, separate from editorial annotations.
Reader history and the moderation queue paginate, so older imported comments
remain reachable. New submissions are plain text and pending, have a honeypot and per-email/post
rate limit, resolve a contact without marketing consent, and notify the owner
through ordinary notification preferences. Owner moderation and site/post
switches control new submissions; approved history remains readable when new
comments are closed. WXR ordinary comments retain dates, moderation state and
parentage. Unsupported comment types and comments on ordinary pages remain
reported as skipped. Contact merge/undo, private export and erasure include the
comment reference. Rollback removes this import's comments and unused profiles,
retaining profiles and ancestors used elsewhere.

Publication activates query-ID and parented attachment aliases. The proxy asks
the public redirect service over loopback at the application's `PORT` (3000
by default), without forwarding cookies,
credentials or request headers, follows stored chains in the service and emits
a literal 301 before slash normalization. It performs one bounded (1.5 second)
internal request per public GET/HEAD page; internal routes and assets bypass it.
A network-isolated demo therefore needs no outbound exception to ask its own
service. Public redirect destinations still use the configured `APP_URL`, never
the loopback address or the request's Host header.
A resolver outage preserves content availability, but may degrade historical
redirects: the verification must fail that path rather than accept it.

## Read-only acceptance report

After reconciliation and explicit import publication, export the JSON result of
`imports.wordpressVerificationPlan` for the run. This scoped query changes no
site content. Run:

```sh
node scripts/verify-wordpress-migration.mjs PLAN.json https://destination.example REPORT.json
```

The operator-owned plan and report stay private. The script fetches source and
destination without cookies, requires final HTTP 200 after at most one redirect,
requires literal 301 for aliases, checks canonical/imported search and social
text, compares rendered source title/description/robots/hreflang and records
missing source evidence. A report with failures, warnings or unresolved source
features exits nonzero. This is cutover evidence, not permission to change DNS.

## Remaining cutover decisions and limits

- WordPress `/feed` collides with Freeholder's existing member feed. The new blog
  Atom feed is `/feeds/blog.xml`; root `?feed=rss2`, `?feed=atom` and `?feed=rss`
  aliases reach it. The reserved path needs an owner-selected migration plan
  before DNS cutover; it is not silently overwritten.
- Orphan attachment pages need an owner-selected destination. Parented
  attachment pages and `?attachment_id` links redirect to their parent post.
- WXR omits rendered hreflang and plugin-generated metadata. A source crawl is
  required for parity acceptance; an inaccessible source remains uncertainty.
- External Open Graph image URLs remain their original source URL. Confirm
  long-term image availability or replace them with an owned image before
  retiring the original host. Failed media downloads remain visible in the
  original importer report.
- Source subdirectory roots, plugin-specific archive bases, multilingual-plugin
  URL routing and custom post types require source-crawl comparison. No blanket
  WordPress parity claim is made for data an export does not carry.
- No production deployment, release, DNS cutover or LinkedIn publication is
  authorized by a local passing test. The LinkedIn draft remains on hold.

## Validation record

Disposable PostgreSQL 16 at a private loopback port, containing only fixtures,
was used for migrations and importer/comment tests. No production database or
personal browser state was used. Exact final commands and results are recorded
in the pull request; browser, release and deployed acceptance remain separate.

## Peer-review regressions

A two-locale, same-slug fixture returned a vetoed row's approved comment before
the exact-ID correction. The preserved failing result was a local fixture, not
a production disclosure. The new regression verifies refused reads/submissions,
no hidden archive/category, canonical byline identity and one visible listing.
A second regression replaces a live post with an ordinary WordPress page, then
rolls back, preserving the same approved comment ID and its privacy boundary.
Both fixes belong to C2.29/C3.46; deployed acceptance remains pending.

The standalone browser run completed owner/public functionality, email/XSS
privacy checks and eight light/dark Axe scans, then reproduced a redirect500:
native Response.redirect headers are immutable. The proxy correction creates
a mutable NextResponse before applying CSP; the full-proxy regression and the
repeated real-browser literal301 assertion qualify that boundary separately.

The next browser run returned the required301 and a valid relative Location;
the overly strict absolute-header assertion was a harness defect. The harness
now resolves that header against the trusted test origin before asserting the
exact destination, retaining the one-hop and origin checks.

Full CI found the new comment contact foreign key and public submission were
unclassified in the existing search, retention and playground completeness
guards. These were product integration omissions. Comments remain discoverable
through the scoped moderation queue; page deletion and `cms.readerComments`
privacy erasure govern their discussion history instead of a notes TTL.
Playground submissions use a 200-row comment cap and the existing shared
contact/client limits, with external notification delivery still blocked.

The new native playground regression first reproduced two content-service
refusals, then called the actual create-blog server action using a genuine
disposable session cookie and reproduced its redirect back with a refusal.
The form unnecessarily invoked operator-only bootstrap even though playground
startup already seeds chrome. It now uses that seeded chrome and explicit
content permissions. Pages/authors/terms have limits; a shared transaction
insert guard also covers inline tag batches and concurrent last-slot creators.
The framework request context/redirect is simulated; actor resolution, grants,
services and PostgreSQL are real. Deployed demo acceptance remains open.

Separate source-review limitation (CMS/kernel, C1.38): the page cap remains a
preflight outside `createPage`'s insertion transaction. These author/term and
inline-tag tests do not qualify a strict concurrent page cap. Native race
reproduction, shared page-insertion serialization and deployed acceptance are
a scoped follow-up; no live page-overflow incident has been demonstrated.

The redirect repair's protected browser check also reproduced a listener-family
mismatch: `localhost` may bind IPv6, while a fixed IPv4 resolver cannot reach it.
The internal resolver now selects localhost for that configured listener and
IPv6 loopback for `::`/`::1`; other listen hosts select IPv4 loopback. No request
header or arbitrary configured hostname becomes an outbound destination. Real
IPv4, IPv6 and localhost HTTP regression listeners all return the intended 301
without receiving visitor credentials.

## Hosted qualification, 2026-11-10

Protected PR, merge-queue and main CI passed for #640. The main workflow's
signed candidate was verified against its exact source and trusted workflow:

- Source: `e65773459a9e1d8cde977a0e16432e91bf65d796`.
- Image: `ghcr.io/campdenman/freeholder@sha256:1146f32c8fbe68c55c6610c6d4bb2daef7f01d647289d41594d0b343717e4192`.
- Main CI: https://github.com/CampDenman/freeholder/actions/runs/42897693255.

Only the disposable demo was updated. Docker's running image and source label
matched the verified candidate. Production remained on `c3215f63`, with ready
workers, zero failed jobs and zero dead letters.

A real Chromium browser completed ten checks on `demo.freeholder.ai` using
fictional records: playground entry; guest author creation with private email;
parent/child category and flat tag creation; published post and all three
archives; sitemap inclusion; one literal 301 after moving the parent category,
followed by a direct 200 for its descendant archive; author biography and tag
edits; a pending anonymous comment becoming public only after moderation,
rendering markup as text without the reader's private email; WCAG AA Axe scans
in both actual cookie-selected themes; and deletion of an unused tag. The
run started at 2026-11-10T21:13Z and completed with no browser page errors. Its
private copy is retained on the deployment host; no cookies or credentials are
in it.

The demo was reset after qualification. A subsequent read-only check confirmed
the same running image/source, ready public health, no failed/dead-letter jobs,
and 404 for the discarded post. A fresh Chromium visitor could enter the
reseeded admin. The receipt and reset log are retained privately on the host.

This qualifies those deployed demo paths. It does not qualify production
deployment, actual WordPress source-crawl/cutover parity, scale acceptance,
private hosted previews, owner/agent acceptance in Replit or Lovable, provider
settlement, independent review or the final stable candidate. The C2.27–C2.29
boxes remain open for their remaining criteria.
