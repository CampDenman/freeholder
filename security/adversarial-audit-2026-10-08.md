# Adversarial audit and repairs — 2026-10-08

This is implementation and regression evidence for MASTER.md §43, not an
independent security sign-off. Three adversarial agents reviewed separate
customer, security and platform worktrees based on main
`4ba5daac5eeea6a2202b1b3972defed13cb325a1`; the integrating agent reviewed
public CMS delivery and editor concurrency. C11.10 remains unchecked, and
Freeholder remains `0.2.0-beta.3` in active development.

## Findings and repairs

| Surface | Reproduced failure | Repair and durable evidence |
| --- | --- | --- |
| Published pages | Public JSON included unpublished working fields and nested gated bodies. | Explicit published-field projection; public JSON strips gated children. A server-only resolver feeds the existing viewer-aware renderer. `tests/core/cms-public-boundary.test.ts` proves anonymous refusal and entitled HTML delivery. |
| Editor and templates | Concurrent writes with the same version both succeeded; template rejoin changed live content; typing during an outstanding save or publish was marked saved. | Row locks, reviewed publish versions, canonical draft updates and captured save snapshots. `tests/core/cms-public-boundary.test.ts`, `cms-layouts.test.ts`, `editor-inline-edit.test.ts`, `page-editor-publish.test.ts`. |
| Password recovery | Concurrent redemption accepted one reset twice; invalid reset attempts exhausted a shared global allowance. | Atomic single-use token claim and a token-derived rate-limit subject. `tests/core/password-reset.test.ts`. |
| Customer records | Customer lists exposed draft records, owner notes, unpublished project content or internal billing/provider fields. | Exact staff-read checks and customer projections; drafts withheld where appropriate. `tests/core/adversarial-portal-privacy.test.ts` and customer subscription tests. |
| Gallery delivery | Generic media delivery bypassed gallery control; ZIP access survived policy/content changes; concurrent downloads exceeded a quota. | Private client-gallery assets, internal byte authorizers, archive delivery hashes and serialized quota claims. Legacy ZIPs require rebuilding. `tests/core/adversarial-gallery-privacy.test.ts`. |
| Booking | Offered capacity exceeded a calendar's capacity; shared calendars ignored external busy time; daily caps counted hypothetical offers. | Effective capacity ceiling, external busy exclusion and actual holding-booking counts. `tests/core/resolver.test.ts`. |
| Billing and prices | Cancelled subscriptions could charge or regain access from late results; a stored method could pay an unrelated invoice; mismatched provider amounts/currencies settled invoices; private prices lacked caller ownership checks. | Locked canonical state, pre-provider invoice ownership checks, exact settlement evidence and authorized contact price resolution. `tests/modules/subscription-billing.test.ts` and `tests/modules/adversarial-customer-privacy.test.ts`. |
| MCP | Date-bearing inputs erased whole tool schemas; malformed JSON-RPC entries could crash requests. | Shared contract schema conversion and structural envelope validation. `tests/core/mcp-input-schema.test.ts` and `mcp.test.ts`. |
| Campaigns and consent | Overlapping workers could stage copies twice; stale edits could overwrite sending campaigns; delivered copies lacked usable opt-out capabilities; GET scanners changed consent; contact merges broke previously delivered opt-out links. | Campaign/recipient locks, stable delivery keys, private unsubscribe links and provider headers, pre-delivery consent checks, explicit POST confirmation and private token aliases preserved through repeated merges. `tests/modules/broadcasts.test.ts` and newsletter customer-surface tests. |
| Installation | Preflight accepted undersized encryption keys and could disclose credentials embedded in a malformed public URL. | Exact credential key length, safe origin validation and redacted reports. Installer, launch and preflight regressions. |

The security and customer reviewers each reproduced twelve failing baseline
assertions. These counts describe regression cases, not twelve distinct
vulnerabilities per reviewer. The CMS/editor baseline reproduced six failing
assertions before repair. Platform findings include direct schema conversion
reproduction and targeted race/consent regressions. No real customer mail,
payment, provider account or production database was used for these tests.

## Verification and operational limits

Tests use private disposable databases in a separate, memory-limited Postgres
container, never production fixtures. Focused exploit tests are paired with
valid delivery, entitled rendering and successful billing controls. Protected
CI supplies full application, database, browser, packaging and deployment
gates; its immutable run and deployment receipt belong in the integration PR.

The focused customer run passed 15 selected cases, including three valid
billing/renewal controls; 25 unrelated cases were intentionally deselected.
The security run passed 46 of 47 selected cases; the archive recovery
assertion initially used a handler cached before its final edit, and a fresh
narrow run passed that case. This is evidence for all 47 cases across runs,
not a claim that the first command passed. Platform checks passed six selected
database cases, 35 installation/schema/mock-provider cases, 81 locale/token
cases and seven malformed-request cases. A follow-up reproduced the old-link
404 after a real contact merge, then passed two selected cases covering
transitive merge survival and queued/future suppression. Six mocked gallery
delivery route cases and two further real-database URL/authorization cases
passed after controlled agent delivery was declared. CMS checks include a fresh 11-case
boundary/layout/internal-service run and nine editor tests, followed by a
separate positive entitled-rendering check. Broad local suites that were
stopped for slow remote round trips are not counted as passes.

The integration contract suite first passed 347 cases and failed two mobile
service-parity assertions that still named the internal gallery byte authorizer.
The mobile client already used the controlled HTTP route. Its screen now
declares and checks that HTTP read separately from RPC services; all 93 focused
mobile contract/cache/shell cases and package/app type checks passed. Private
cache lease and denial eviction are preserved. Physical device acceptance
remains deferred under §43.18.

Client-gallery storage must be private at the object provider. An application
privacy flag cannot repair a public bucket or recall delivered copies or
previously issued provider URLs. Paywall block delivery and media object
visibility are separate policies; this audit does not claim that revoking an
entitlement revokes a previously downloaded file.

Queued bulk mail rechecks consent before provider I/O. A request already
started at a provider cannot be recalled. Actual external inbox delivery,
sender authentication and provider one-click handling remain acceptance work.
Live payment settlement, restore with actual object bytes, independent review,
actual owner Replit/Lovable launches and final stable acceptance remain governed
by the open items in MASTER.md §43.

## Dependency alert follow-up (C1.20, C10.23)

GitHub reported five open dependency alerts during this audit. All five came
from `apps/mobile/package-lock.json`, the Expo application outside the root
pnpm workspace. The server/workspace lock already contained shell-quote 1.12.0
and source-map-js 1.2.2 and contained none of compression, braces or node-forge.
The unchanged root `dependency:audit` gate reported no known advisories.

| GitHub alert / primary advisory | Mobile dependency path | Disposition |
| --- | --- | --- |
| #10 / [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), critical | `react-native` → `react-devtools-core` → `shell-quote` | Lock updated from 1.10.0 to 1.12.0; first patched release is 1.11.0. |
| #9 / [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), high | `expo` → `@expo/metro-config` → `postcss` → `source-map-js` | Lock updated from 1.2.1 to patched 1.2.2. |
| #8 / [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95), high | `expo` → `@expo/cli` → `compression` | Lock updated from 1.8.1 to patched 1.8.2, including its required `destroy` dependency edge. |
| #7 / [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | Expo/React Native Metro file maps → `micromatch` → `braces` | Open. Latest published braces remains affected 3.0.3; primary advisory lists no patched release. |
| #6 / [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), high | `expo` → `@expo/cli` / `@expo/code-signing-certificates` → `node-forge` | Open. Latest published node-forge remains affected 1.4.0; primary advisory lists no patched release. |

The three upgrades fit the existing parents' semver ranges and change no direct
dependency or unrelated package version. A fresh isolated
`npm ci --ignore-scripts --no-audit --no-fund` and the mobile TypeScript check
passed. Expo exported both native platforms successfully: 904 iOS modules and
1,337 Android modules. These are local bundle checks, not signed device or
store acceptance. The post-fix mobile audit reports zero critical findings and two
underlying high advisories; its total of 20 high package nodes includes the
Expo/Metro parents that inherit those same two findings. This is not a clean
mobile dependency audit.

Neither remaining advisory is dismissed, considered a false positive or added
to an exception ledger. The existing ledger stays empty and security gates are
unchanged. GitHub marks the mobile entries as runtime dependencies; their
toolchain dependency paths alone do not prove absence from a device bundle or
unreachability. Mobile remains v2-deferred, and these two findings remain
blockers for its release, as already recorded in the stable acceptance receipt.
Primary advisory metadata and npm publication versions were checked on
2026-10-08; a forced downgrade to an old Expo/React Native major is not an
accepted compatible repair.
