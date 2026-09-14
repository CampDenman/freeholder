<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Project audit — 2026-09-13

Audit of the checkout inherited from the prior agent session, starting at
`7cd57a5`. This is an evidence report, not a roadmap or completion authority.
`MASTER.md` §43 remains the sole completion checklist. Findings below are
repairs merged through PR #361 (`96570e7`); this document does not claim deployment or an
independent reviewer sign-off.

## Findings and repairs

| Finding | Impact | Repair and executable evidence |
|---|---|---|
| Gated community reads accepted a member email from an anonymous caller. Member posting and moderator actions also derived identity from submitted email. Gated reporting returned post contents without checking membership. | High: private discussion disclosure and member/moderator impersonation through public services. | Session-linked `contacts.userId` is the identity for member reads, posts and moderation. Reports check the same read boundary. Public pages/actions propagate the existing authenticated actor. `tests/core/community-rooms.test.ts` passes seven tests including forged email, signed-in outsider, anonymous moderator, member impersonating a moderator, and genuine member behavior. The gated-community browser journey passes with an anonymous caller, outsider, and signed-in member posting through the form. |
| Managed-agent proposals resolved private services with the internal registry; approval execution did the same. | High: the gateway could park private payment apply phases and reach internal queries. | Resolve targets with the public dispatcher’s visibility filter at proposal and approval time. Both regressions failed before repair; all 24 agent autonomy/approval tests passed after repair. |
| Capture session IDs bypassed media authorization, and upload staging accepted caller-supplied storage metadata as a public service. | High: private capture capabilities could be disclosed and sessions modified without media authority. | ID access requires the exact media scope and read-only access redacts bearer URLs/upload handles, phone tokens retain the capability lane, completed-upload staging is system-only, and phone binding accepts only uploads made through that link. All 14 capture/mobile regression tests passed after repair, including the ordinary proxy and reserved-upload paths. |
| Global search treated any scope with a matching module prefix as read authority, and used contact/CRM grants for notes, conversations and tasks. | High: a key authorized only for contact creation could read existing contact names and emails; related staff grants crossed data boundaries. | Each source names an existing scoped read service. Search uses its registered permission and ordinary authorization function. The new regression failed before repair with a leaked contact and passes afterwards. All 16 tests in `tests/core/c11-14-search.test.ts` passed. |
| Print, marketplace and voice/video adapters unconditionally returned test fixtures, including synthetic vendor IDs, transcripts and durations. | High operational impact: a deployed instance could claim work was accepted by a vendor when no request was sent. | Provider factories refuse outside `NODE_ENV=test`. Existing claim/apply workflows record their error and retain retry state. Provider acceptance also no longer marks the catalog fulfillment shipped or uses a vendor order ID as carrier tracking. `tests/core/plugin-provider-boundary.test.ts` exercises production, development and test behavior. This does not implement the missing live providers; C3.13 remains open. |
| Provider claim paths did not consistently exclude simultaneous callers. | Duplicate vendor operations and competing progress updates. | Print and voice/video claims now lock their existing rows and refuse an already pending recording. Seventeen plugin integration/concurrency tests passed. Marketplace sync now fences expired workers and atomically imports contact/invoice/channel-order records. Its regression tests pass for exclusive claims, expiry/recovery, stale import/checkpoint refusal, idempotency and rollback. |
| The performance fixture declared five record families but inserted only contacts. Revenue measurements read an empty invoice table. “Server render” only resolved page data. | Misleading completion evidence. | The fixture inserts and verifies all declared families, linked product variants/order lines and paid invoices with known totals. CMS timing now includes actual block rendering and HTML serialization. Small, medium and large runs pass locally; whole-page HTTP/layout and reference-target timing remain unproved. Asset rows are metadata fixtures, not stored media files. |
| A performance run could succeed with its database test skipped. NaN or negative measurements could pass comparisons. Large pagination bypassed requested auxiliary measurements. | False-positive release gates. | Explicit test-database requirement, required passing measurement in the runner report, finite/nonnegative validation, and requested-surface enforcement. Regression tests cover missing database, bad clocks and missing requested browser data. |
| Contact pagination sorted only by creation timestamp. | Imports can create timestamp ties, allowing repeated or omitted contacts across OFFSET pages. | Unique ID breaks ties; `0006_contact_pagination.sql` adds the supporting index. Tests assert exact order for 60 tied contacts and distinct first/second/final pages at 100,000 contacts. |
| Any failure to pull the previous release image made the upgrade gate exit successfully. | Missing rollback evidence could pass CI after registry/network failure. | The gate now fails with a concrete diagnostic. A subprocess test supplies a failing Docker command and asserts a nonzero result before any database operation. |
| SDK generation returned success when the live-registry generation test skipped. | A stale client contract could be presented as freshly generated. | Require a disposable database and a passing live-generation assertion in the test report. Subprocess tests reproduce missing database and a successful runner whose generation step skipped. Regeneration with a real database passes all eight SDK tests. |
| Accessibility list checks labelled inherited theme state as “light”; 22 named admin lists had no browser scan. | Incomplete/mislabelled accessibility evidence. | Set and assert each theme explicitly, and cover all 22 named omitted lists. The expanded production-build Chromium accessibility journey passes. It does not prove every detail form, complete keyboard workflow, viewport and locale combination. |

The audit also reopened C0.11, C11.09 and C11.16. Static evidence stamps and
section inventories did not establish the full completion claims; C11.16's
old test explicitly asserted completion while requiring unfinished work.
The corrected test refuses that combination.

## Additional catalog authorization findings — 2026-09-14

`catalog.getOrder` was public and returned private order addresses and line
items for a supplied UUID. The regression reproduced anonymous disclosure.
The query now requires scoped catalog read authority, matching its staff UI.
`tests/core/catalog-orders.test.ts` covers anonymous/customer/unrelated staff
and write-only key refusal, plus authorized staff and exact read-key access.
The same review reproduced anonymous raw inventory holds with caller-chosen
holder IDs/expiry, and stock-notification enrollment for a supplied contact ID.
Raw holds now require catalog management; guest carts already use checked
system composition. Enrollment verifies the signed-in contact or catalog
management authority. Inventory/procurement tests cover the denials, unchanged
stock after refusal, own-contact enrollment and cross-contact refusal. This
follow-up remains separate from the frozen #361 evidence above and does not
constitute independent security review.

## Verification scope

Completed local evidence:

- Production build and standalone artifact gate: passed; no source/environment leakage.
- Fast gates: typecheck, lint, licensing, changelog, plan and 34 required contract suites passed (300 tests, one explicitly database-dependent skip). The frozen audit revision passed these gates.
- Dependency audit: no known advisories reported by the configured live scanner.
- Package artifact gate: seven packages packed, installed and exercised.
- Local dump/restore rehearsal: 353 tables and 147 rows matched, then exported. This fixture had no media objects and did not exercise separate hosting providers.
- Browser journeys: all nine production-build journeys passed, covering visitor-to-paid,
  app-free capture, setup/auth/editor/publishing/forms/contacts/translations/API/MCP/recovery, demos, guidance and plugins. This run preceded the later capture authorization repair.
- Browser accessibility: expanded run passed in both themes, including 22 additional owner lists.
- After the capture authorization repair, the capture, registry and authenticated gated-community browser journeys passed again (three tests).
- Focused search, community, provider, SDK and performance regressions described above.

Mobile TypeScript checks and both Android/iOS native bundle exports passed.
The plugin/performance integration rerun passed all 25 tests. The full database
suite was restarted on a separate disposable PostgreSQL instance with fsync,
synchronous_commit and full_page_writes disabled to avoid spending hours flushing
empty test tables. The existing server was not changed. This functional run is
not crash-durability or reference-performance proof. Subsequent changes have
dedicated reruns. The first complete run reported 3,534 passed, 17 inapplicable recipe cases
skipped and two failures from service snapshots loaded before the later
shipping/capture fixes. Both affected files subsequently passed. The frozen-code
rerun subsequently passed all 339 files: 3,541 tests passed and 17 inapplicable
recipe cases skipped. Hosted CI and the protected merge queue passed, including
Docker recipe, public surface and upgrade gates. PR #361 merged without bypass.

## Hidden location read boundary

A regression reproduced anonymous access to hidden location addresses through
`locations.list` with `includeHidden`. The repair requires location read scope
for that option and filters hidden records from public ID/slug lookups. Tests
cover anonymous and unrelated staff, write-only and exact read API scopes, and
location viewers. A second regression reproduced address snapshots remaining
in generated-page SEO after hiding a location. Public page and sitemap reads
now enforce linked location visibility before event delivery; the listener
then unpublishes the page. POS and social selectors request hidden locations only for
staff with location read access. This is an additional internal repair, not an
independent security sign-off.

## Limits of this evidence

No live payment settlement, provider account connection, production deployment,
physical-device interaction, reference-droplet performance measurement or owner
completion signature was performed. Provider fixtures are test evidence only.
An independently signed security review is still required by C11.10. The
remaining completion requirements, including record restore, real providers,
RTL and device proof, stay in `MASTER.md`; none are waived by this audit.
