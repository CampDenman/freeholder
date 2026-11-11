# C11.10 independent security-review packet

This is a briefing packet for an independent reviewer. It is **not** the
review. C11.10 stays open until a reviewer who did not author the surfaces
below has resolved every critical/high finding and dispositioned every lower
one.

Prepared 2026-09-12 from the tree at this change. Threat surfaces, existing
tests, and known residuals only — no claim that the list is empty.

## 2026-11-10 review assignment and alert remediation

Tony Aly selected himself to perform the review and requested completion of
the full current specification before stable publication. This records the
review assignment, not a completed review or owner signature. `MASTER.md`
§43 remains the status authority; C11.10 and C11.17 are open.

The audited baseline is main `4d86abc06db4345da37346e18b7918a516e681c6`.
[Its protected main CI](https://github.com/CampDenman/freeholder/actions/runs/42596963219)
passed, including database tests, browser journeys/accessibility, CodeQL,
dependency evidence, and the backup/restore and image/upgrade jobs. Local fast
gates passed 367 contract tests in 40 files, with one test skipped. These runs
are supporting evidence for the review.

The two remaining CodeQL password-hashing alerts were traced to their exact
sources and dispositioned as false positives, with the rationale retained on
each alert:

- [Alert 5](https://github.com/CampDenman/freeholder/security/code-scanning/5):
  `mintApiKey` generates 32 cryptographically random bytes. `hashApiKey` uses
  keyed HMAC-SHA256 for indexed token lookup. It does not store a human password
  verifier. The reported source was a minted token in `apikeys.test.ts`.
- [Alert 6](https://github.com/CampDenman/freeholder/security/code-scanning/6):
  `equalSecretText` hashes two transient Basic authorization values to equal
  lengths for `timingSafeEqual`. Neither hash is persisted as a password
  verifier. `verifyPostmarkAuthorization` refuses a mismatch before parsing or
  recording a delivery event.

Human passwords use salted scrypt in `src/core/auth/passwords.ts`. The local
API-key, mail-webhook and password suites passed 23 tests; their 22
database-dependent tests skipped locally and are covered by the baseline's
protected main CI. This classification must be revisited if token generation,
credential storage or the comparison data flow changes. The CodeQL rule
[addresses stored password hashes](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/).
The rule and security scan remain enabled.

The separate Expo lockfile had real dependency vulnerabilities. Its patch
updates node-forge to 1.4.3 and decode-uri-component to 0.5.1, removes the
vulnerable zod/deepmerge paths through compatible dependency updates, and
overrides only `@expo/fingerprint`'s glob/minimatch dependencies to patched
14.0.4/11.0.5 releases. Expo's major version is unchanged. Pull-request CI and
the scheduled security workflow now audit `apps/mobile/package-lock.json`
independently at the moderate threshold. Native compatibility checks belong
to the repair PR: a clean `npm ci`, TypeScript check, Android and iOS exports,
and two identical fingerprint generations (65 sources) passed. The final npm
audit reports zero vulnerabilities at every severity. This does not close the
deferred mobile acceptance items.

The reviewer must also examine the new plugin permission/consent/runtime
controls (C3.40), the newly implemented network wrapper (C3.41) and publisher-
signature boundary (C3.42), member cryptography
(C12.39), and current upload/payout/preview-assistant boundaries. A closed
automated alert does not establish their security. Live provider acceptance,
cross-target object-byte recovery and actual platform launches retain their
own open checklist items.

## Seller collection-policy and original-account boundary (C12.38, partial)

Review the private invoice/subscription policy snapshots and payment routing
in `src/modules/invoicing/market-policy.ts`,
`src/modules/invoicing/merchant-charge.ts`,
`src/modules/subscriptions/market-policy.ts` and
`src/modules/members/market-merchant.ts`. Check account/actual-fee evidence,
saved customer/method account isolation, original-account refunds and recurring
operations, response privacy, trial policy capture, and preservation of unknown
charge outcomes. Migration 67 must not turn a historical transfer account into
an authorized merchant. `deploy/seller-merchant-source-2026-11-10.md` records
the limited source evidence and remaining integration. The direct model stays
unavailable; this packet supplies neither activation nor independent sign-off.

The continuation also needs review of signed Connect-to-payment forwarding,
account-scoped trial setup and card selectors, recurring InvoicePayment and
PaymentIntent enrichment outside database transactions, canonical period/fee
checks, and `src/modules/invoicing/merchant-settlement.ts`. Check that a direct
seller earning cannot trigger a second transfer, owner settlement cannot invent
a direct charge/refund, and order/invoice recorders cannot duplicate earnings.
Synthetic provider evidence and seeded browser setup are explicitly limited
in the source document; they are not live-provider or independent acceptance.

## Authenticated provider-evidence boundary (C11.10)

The audit found that `invoicing.processPaymentProviderEvents` was declared as
financially scoped and appeared in generated external discovery despite its
intended webhook-only contract. The repair makes it system-only and explicitly
private. Financial administrators, API keys and invoicing-capable plugins must
be refused before ledger access; HTTP, OpenAPI, MCP and SDK projections must
omit it. `tests/core/internal-services.test.ts` exercises these boundaries.
Existing signed-webhook, provider-ledger and subscription regressions keep
the actual verification path working. The reviewer should verify both the
refusals and the positive signed route. On the merged merchant-policy baseline,
54 focused financial/discovery regressions and all eight live SDK checks
passed. Required local fast gates passed 368 contract checks with one deliberate
skip, plus typechecking, lint, licensing, release notes and plan consistency.
These results do not supply live-provider acceptance or independent sign-off.

## Newly published XML parser advisory

The 2026-11-10 C3.42 protected CI run independently caught
[GHSA-474x-hrwr-fgx4](https://github.com/advisories/GHSA-474x-hrwr-fgx4),
published in GitHub's advisory database that day. It affects fast-xml-parser
through 5.11.2; the upstream patched release is 5.12.0. The direct storage
inventory parser and the inherited `@replit/object-storage` →
`@google-cloud/storage` path both move to the patched 5.x version. No exception
was added and the audit policy stays unchanged. The unchanged live audit
reports no known advisories, 13 storage-inventory acceptance/refusal tests pass,
and the production build/standalone artifact gate pass with the patched
parser. Twenty publisher CLI/activity-label checks pass on Node 22.23.2,
including actual artifact and catalogue signing. Protected exact-head CI is
required. This remains automated remediation evidence, not the independent
C11.10 review.

## 2026-10-03 automated-alert triage (preliminary)

This update is preparation for C11.10, not independent sign-off. GitHub CodeQL
reported thirteen open alerts when this round began. The storefront and visual
editor changed after the original packet was written, so the reviewer must
walk their public and owner paths as well as the surfaces below.

| Alerts | Initial disposition and evidence to check |
| --- | --- |
| #4, #2, #22 | This change restricts rich-text links to web/mail/phone/relative URLs, removes modulo bias from recovery-password generation, and replaces a slow mobile slug trim with linear scans. Focused regressions cover each. Confirm CodeQL closes these on `main`. |
| #1 | The recovery CLI deliberately displays a newly generated password once. It does not run inside an HTTP request, but redirected terminal output can retain the secret. Review its operator instructions and whether a TTY-only display is warranted before dismissing the alert. |
| #5, #6 | API keys are 32 random bytes authenticated with HMAC-SHA256; the mail webhook hashes two presented Basic values for constant-time comparison, not for stored password verification. Confirm those assumptions and key lifetimes before treating the password-hash warnings as false positives. |
| #7, #11–#13, #18 | The importer uses regex for partial HTML extraction and entity decoding. Committed content passes through the parse5 allowlist in `src/modules/cms/blocks/html.ts`, but preview and malformed-input behavior still need a direct review. |
| #9, #10 | These are in `scripts/a11y-smoke.mjs`, a test utility rather than a served route. Confirm no untrusted CI input reaches its generated markup. |

The alert numbers refer to the repository's Code Scanning list. No alert is
treated as resolved merely because this table names it.

## 2026-10-05 release security repairs (awaiting independent review)

The current automated scan has ten open alerts. This repair addresses importer
alerts #7, #11–#13 and #18 with parse5 text extraction and CMS-allowlisted preview
markup; `tests/core/importers.test.ts` covers malformed script attributes, encoded
URL schemes, numeric references and one-pass decoding. The accessibility helper
(#9/#10) uses JSDOM outside-only execution; it no longer enables page scripts and
then attempts regex removal. The browser-like parser determines document structure.
`tests/core/a11y-smoke.test.ts` exercises scripts with closing angles in attributes.

Recovery CLI alert #1 is addressed by never echoing supplied/generated passwords.
Generated credentials go to an exclusive mode-0600 file in a mode-0700 directory;
stdout contains only the path and salted scrypt SQL. Tests prove compatibility
with the app verifier, filesystem permissions and secret absence from output.
Operators must retrieve/delete the private file on the machine or container where
they ran recovery. The supplied-password form can still leave shell-history and
process-argument exposure; prefer generated recovery in a secure local shell.

Alerts #5/#6 remain candidates for false-positive disposition, not dismissed here:
API keys contain 32 cryptographically random bytes and use a keyed HMAC for an
indexed lookup, not a human-password digest. Postmark compares hashes only to
normalize timing of two transient presented Basic values; neither hash is stored
as a password verifier. An independent reviewer must confirm these assumptions.
The refreshed CodeQL run must also confirm the repaired alerts close on main.
This section does not check C11.10 or supply independent sign-off.

## 2026-10-08 adversarial implementation audit

Three agents reviewed auth/customer privacy, customer money/booking paths and
platform/MCP/consent. The integrating agent reproduced public CMS disclosure
and editor races. Repairs, baseline assertions and operational limits are in
`security/adversarial-audit-2026-10-08.md`. Review the published-field projection,
trusted renderer, gallery privacy backfill and archive invalidation, atomic
reset redemption, customer record projections, billing ownership/settlement
checks and durable unsubscribe delivery in particular.

These are implementation tests by coding agents, not independent review.
C11.10 remains unchecked. Validate private object-provider policy and external
mail/payment acceptance separately; a green mocked provider is not evidence of
live delivery or settlement.

## 2026-10-21 pre-launch audit

Four read-only agent reviews found access-control, money-path and
transaction-boundary defects. Each repair (#559–#565) was reviewed by a
separate agent until nothing blocking remained.
`security/pre-launch-audit-2026-10-21.md` maps every finding to its PR and
lists the open residuals. Give these the closest look: the playground
allow-list, unverified site chat, payout retry and resend rules, the payment
claim/apply phases and their system elevation, and per-client rate limits
where no trusted client-IP header is set. This is agent work, not independent
review. C11.10 stays open.

## Return refund evidence (C5.19/C11.10)

The subsequent original-provider action reserves every installment and a draft
credit before provider I/O. Original account/fee routing remains private in
the shared payment orchestrator. Durable refund confirmations close the RMA
only after the entire assigned amount succeeds; unknown outcomes retain their
reservation and a new attempt after definite refusal covers only the remaining
balance. Both return money actions require fresh human verification and refuse
keys/plugins. Original discounted consideration and tax use cumulative integer
allocation, including earlier draft credits. Review the private reservation and
reconciliation services, partial-success retry, original-account feedback and
concurrent rounding cases. This source work supplies no independent sign-off.

The audit reproduced `catalog.refundReturn` recording a purported provider
refund without contacting the provider, closing a return after refunding only
the first payment's available balance, and failing a safe replay of an
installment return. The repair reserves and settles only fully covered,
human-attested offline refunds, requires fresh verification, refuses agent
keys/personal keys/plugins, and binds credit/refund identities to the return
and original payments. Return requests lock their order and bound quantities
across duplicate lines and previous non-rejected returns. Review these
boundaries in `src/modules/catalog/fulfillment.ts` and
`tests/core/catalog-fulfillment.test.ts`.

Three pre-repair regressions reproduced the failures. All 11 repaired
financial/manual journey cases and eight live SDK checks passed. Four real
Chromium owner journeys cover explicit confirmation and full installment
recording, keyboard use, 320px, both-theme Axe scans and all four locales in
`tests/browser/return-refund.spec.ts`. Settlements are seeded offline evidence,
not a real provider transaction. The production build/artifact scrub passed.

C5.19 remains open for mixed offline/provider returns, complete localized
customer journeys and actual enabled-provider acceptance. The subsequent
provider action and original discount/tax allocation above extend the source
repair; neither supplies C11.10 sign-off. Historical/manual C11.02 evidence
retains its explicit scope. No historical ledger was rewritten by this repair.

## How to use this packet

1. Read `SECURITY.md` for reporting, dependency policy, and 2FA/recovery.
2. Work the surfaces in the order below. Each names the code, the tests that
   already exist, and the residual that a reviewer still has to judge.
3. Disposition findings in the pull request that closes C11.10. Do not treat a
   green CI run as the review.

## Surfaces

### Auth

**What it is.** Email + password for staff, TOTP/WebAuthn/recovery for
privileged grants, magic links for customers, session cookies, API keys,
CSRF, rate limits, security headers, CSP.

**Code.** `src/core/auth/`, `src/core/http/csrf.ts`, `src/core/http/csp.ts`,
`src/core/http/headers.ts`, `src/core/security/rate-limit.ts`,
`src/core/apikeys/`, `app/api/auth/`, `app/(admin)/login/`,
`app/(admin)/security/`.

**Existing tests.** `tests/core/passwords.test.ts`, `two-factor.test.ts`,
`session-management.test.ts`, `http-auth.test.ts`, `http.test.ts`,
`csrf.test.ts`, `csp.test.ts`, `csp-reports.test.ts`,
`security-headers.test.ts`, `rate-limit.test.ts`, `apikeys.test.ts`,
`change-password.test.ts`, `password-reset.test.ts`,
`customer-magic-links.test.ts`, `invitations.test.ts`, `roles.test.ts`.

**Residuals for the reviewer.**

- Privileged grants require 2FA before module grants become usable; confirm
  there is no grant path that skips enrollment (invitations, role edits, API
  keys).
- `SESSION_SECRET` rotation invalidates sessions, API keys, pending links,
  TOTP seeds and recovery codes. Break-glass is a CLI; confirm it cannot be
  reached from HTTP.
- Customer magic links vs staff passwords: confirm a stolen customer link
  cannot mint a staff session.
- CSP report ingestion is minimized; confirm it cannot be used as a storage
  oracle.

### Payments

**What it is.** Hosted checkout adapters, offline ledger, authenticated
provider events, refunds, disputes, saved methods. Money is integer minor
units.

**Code.** `src/adapters/payments/`, `src/modules/invoicing/`,
`app/api/` payment webhook routes, `deploy/commerce-payments.md`.

**Existing tests.** `tests/core/payment-adapters.test.ts`,
`payment-provider-service.test.ts`, `invoicing.test.ts`,
`money-arithmetic.test.ts`, `advanced-money.test.ts`.

**Residuals for the reviewer.**

- Live Stripe/PayPal settlement is still adapter doubles in the C11.05
  journey. The webhook HMAC and idempotent event table are real; a live
  charge is not claimed.
- Duplicate provider events must not double-apply money
  (`onConflictDoNothing` on `provider_event_id`). Confirm amount-drift
  refusal still holds when the first event was `ignored`.
- Manual/offline money is owner-attested. Confirm it cannot be raised from
  an API key without step-up.

### Webhooks (outbound)

**What it is.** Signed outbound deliveries, SSRF allowlist, pinned
transport, retry/backoff, pause after repeated failure, replay.

**Code.** `src/core/webhooks/`, `deploy/webhook-delivery.md`.

**Existing tests.** `tests/core/webhooks.test.ts` (signature, replay window,
metadata SSRF, 500 retry, pause, inspect/replay).

**Residuals for the reviewer.**

- Delivery URLs refuse cloud metadata and private ranges. Confirm IPv6, DNS
  rebinding, and redirect-follow behaviour on the pinned transport.
- Signature timestamp tolerance is 300s. Confirm receivers documented in
  `deploy/webhook-delivery.md` match the implementation.
- Replay is a new delivery with a new idempotency key, not a byte-for-byte
  resend. Confirm that is the intended contract.

### MCP / agents

**What it is.** JSON-RPC MCP over HTTP, tools derived from the service
registry, agent autonomy/budgets/approvals, untrusted-input envelope.

**Code.** `src/mcp/`, `src/core/agents/`, `src/core/apikeys/`.

**Existing tests.** `tests/core/mcp.test.ts`, `agents.test.ts`,
`agents-injection.test.ts`, `agents-autonomy.test.ts`,
`agents-budgets.test.ts`, `agents-approvals.test.ts`,
`agents-pause.test.ts`, `internal-services.test.ts`.

**Residuals for the reviewer.**

- MCP tests speak the protocol as this tree understands it; they do not
  prove a real MCP client. Probe with one.
- System services are hidden from MCP (`permission !== "system"`). Confirm
  `external: false` and `hiddenFromMcp` cannot be bypassed by tool-name
  guessing.
- Untrusted input is marked and must not interpolate into owner-facing
  prose. Injection tests exist; a reviewer should add a payload the suite
  does not already contain.
- Autonomous writes are budgeted and approval-gated. Confirm a paused or
  over-budget agent cannot complete an in-flight run.

### OAuth (mail and calendar)

**What it is.** One-time hashed state, least-privilege scopes, encrypted
refresh tokens bound to row AAD, claim-before-exchange so a failed token
call cannot replay state.

**Code.** `src/core/mail/oauth.ts`, `src/core/connections/oauth-core.ts`,
`src/core/connections/calendar-oauth.ts`, `src/core/connections/crypto.ts`.

**Existing tests.** `tests/core/mail-oauth.test.ts`,
`mail-oauth-callback.test.ts`, `calendar-oauth.test.ts`,
`connection-grants.test.ts`, `connections.test.ts`.

**Residuals for the reviewer.**

- State is consumed before the provider is called. A reviewer should confirm
  every OAuth family (mail send, mail read, calendar) shares that order.
- Tokens never appear in API responses. Confirm logs and doctor output match.
- Losing `CREDENTIAL_KEY` without `CREDENTIAL_KEY_PREVIOUS` makes every
  connection `needs_reconnect`. Confirm ciphertext is not deleted.

### Plugins

**What it is.** Signed registry index, hashed install directory, isolate
loader, permission contract, update/rollback.

**Code.** `src/core/plugins/`, `packages/plugin-kit/`,
`deploy/first-party-plugins.md`.

**Existing tests.** `tests/core/plugin-contract.test.ts`,
`plugins-lifecycle.test.ts`, `first-party-plugins.test.ts`,
`plugin-scaffold.test.ts`, `plugin-publisher-trust.test.ts`,
`plugin-publisher-trust-postgres.test.ts`, and the real owner-browser
`tests/browser/plugin-publisher-trust.spec.ts`.

**Residuals for the reviewer.**

- Review owner-only, freshly verified trust roots; agents, personal API keys,
  staff and system composition cannot add keys. Private PEM is rejected before
  audit retention. Check that the independently obtained fingerprint identifies
  the intended publisher, rather than trusting an artifact-supplied key.
- Ed25519 signatures bind the complete length-framed artifact or a canonical
  registry index plus its URL, with separate signing purposes. Review the
  1 GiB/100,000-entry/64-level bounds, streaming file-change checks and refusal
  of links, nonregular files and ambiguous names. Filesystem owners must keep
  release folders immutable; signature checks do not sandbox in-process code.
- Native tests prove modified bytes are refused on enable, confirmed revocation
  disables matching registrations, retries preserve actual rollback history,
  and revoked/modified previous artifacts cannot roll back. Doctor independently
  checks enabled bytes and cached catalogue trust. Review these boundaries.
- Migration 0065 disables every legacy registration without inventing trust.
  A real 64→65 rehearsal preserved legacy metadata; review the migration and
  owner recovery path in `deploy/plugin-publisher-trust.md`.
- Successful mutations are audited transactionally. Refused calls leave state
  unchanged; this feature does not add persistent denial logging.
- Review C3.41's manifest-bound provider HTTP and recording-download defaults.
  Missing network scope is refused before transport; every DNS answer is
  checked and the connection pinned with core's private-address refusal.
  Redirects, time/byte bounds, cancellation and header handling have native
  tests, including actual local receiver controls. Deliberately bypassing the
  wrapper with raw Node APIs remains possible for trusted in-process code;
  this is not the deferred C3.43 sandbox. Inspect provider factories and the
  social-plugin fixture for accidental unbounded/global fetch defaults.
- Review C3.40's exact-scope consent (`permission-policy.ts`, `permissions.ts`),
  owner-only approval/revocation, `plugin:<name>` service/timeline audit attribution,
  and plugin execution ALS boundaries in `service.ts` and `context.ts`.
  Cross-module calls replace supplied system/owner identities; permitted core
  operations retain core composition authority and plugin audit cause. Inspect
  the narrow own-scope privacy erasure bridge and imported-order refund bridge
  (`invoicing.reconcilePluginRefund`: own source prefix, currency, idempotency,
  remaining credit bounds), denial of generic human-review actions,
  own-namespace event/timeline/job context operations and core callback isolation.
- Inspect `runtime.ts`, CMS rendering/JSON-LD and boot isolation: unexpected
  contribution errors force the current shared transaction to roll back, with
  generic runtime disable persisted after rollback. Earlier committed phases
  are not undone. Expected adapter/provider errors retry. Client widget errors
  have only a local boundary; there is no anonymous disable endpoint.
- Check migration 0066, consent backup/restore, invalid synthetic demo approvals
  on real instances, stale compiled scopes, revocation and actual owner recovery.
  Outbox enrollment records exclude plugins inactive at event commit while
  preserving retry of previously accepted work. Tests include new native
  permission/context cases and actual owner-browser review/widget recovery.
  `deploy/plugin-publisher-trust.md` records the owner procedure and limitations.
  These coding-agent checks do not provide independent security sign-off.
- Rollback of a plugin is not rollback of data it wrote. Call that out.

### Updater

**What it is.** Signed release feed, preflight, snapshot, smoke, cutover,
automatic rollback, target-specific image swap.

**Code.** `src/core/update/`, `deploy/update-*.md`.

**Existing tests.** `tests/core/update-apply.test.ts`, `update-preflight.test.ts`,
`update-feed.test.ts`, `update-policy.test.ts`, `update-check.test.ts`,
`update-escalation.test.ts`, `update-targets.test.ts`, `update-cli.test.ts`,
`update-admin.test.ts`.

**Residuals for the reviewer.**

- `failAt` is a test seam on the local target. Confirm production targets
  cannot pass it from HTTP.
- Feed signatures and key rotation are documented in `deploy/release-feed.md`.
  Confirm the embedded public key matches what CI publishes.
- An interrupted cutover must roll back. C11.13 drills exercise migrate/
  smoke/cutover; a reviewer should still try a killed PID on a real target.

### Uploads / media

**What it is.** Storage adapter (S3/Replit/local), key sanitization,
malware scanner seam, renditions, watermarks, capture sessions.

**Code.** `src/adapters/storage/`, `src/adapters/malware/`,
`src/core/media/`, `app/media/`.

**Existing tests.** `tests/core/storage.test.ts`, `malware.test.ts`,
`media.test.ts`, `media-capture.test.ts`, `media-watermark.test.ts`,
`media-transfer.test.ts`.

**Residuals for the reviewer.**

- `storageKey()` and the local adapter both refuse path escape. Confirm S3
  keys cannot overwrite another prefix.
- ClamAV is optional; `none` states that plainly. Confirm production
  recipes do not silently ship `none` as if scanned.
- Local storage refuses production unless `FREEHOLDER_UNSAFE_LOCAL_STORAGE=1`.

### Customer privacy

**What it is.** Consent evidence, data requests, export/erasure artifacts,
portal self-service, retention TTL on artifacts.

**Code.** `src/core/privacy/`, `app/privacy/`, `app/(admin)/` privacy
screens, `deploy/privacy-rights.md`.

**Existing tests.** `tests/core/contact-privacy-rights.test.ts`,
`record-participation.test.ts`, `ownership-export.test.ts`,
`analytics-consent.test.ts`, `sms-consent.test.ts`.

**Residuals for the reviewer.**

- Artifact download is session-bound and `no-store`. Confirm a guessed UUID
  404s without leaking existence beyond timing.
- Erasure vs retention exceptions: confirm a legal hold actually blocks
  fulfill, and that merge does not resurrect erased rows.
- C11.14 still names undelete-every-row as open. Retention is a bounded
  per-kind policy registry plus `core.applyRetention`, not a TTL on every
  table. Product-wide search is `search.query` over a live registry; do not
  treat contact-privacy tests as coverage of every user-owned table.

## Cross-cutting controls already in CI

| Control | Where |
|---|---|
| Dependency audit, no high/critical, expiring exceptions | `scripts/dependency-audit.mjs`, `security/dependency-audit-exceptions.json` |
| Secret scan | TruffleHog in `.github/workflows/ci.yml` |
| CodeQL | `codeql` job |
| Dependency review | `security` job on pull_request |
| Pinned Actions, no `pull_request_target` | `scripts/workflow-integrity-gate.mjs` |
| License headers | `scripts/license-headers.mjs` |
| Service-layer gate (no Drizzle in routes/MCP) | contract suites |
| Money gate (no float on charge paths) | `tests/core/money-arithmetic.test.ts` |

The ledger of accepted dependency advisories is currently empty.

## Out of scope for this packet (named so they are not forgotten)

- Independent WCAG review (C11.12).
- Performance budgets (C11.11) — harness ships beside this packet; budgets
  are in MASTER.md §15.1.
- Failure drills (C11.13) — `tests/core/c11-13-failure-drills.test.ts`.
- Live provider accounts. Adapter doubles and loopback receivers are what
  CI runs.

## Reviewer sign-off (leave blank)

| Field | Value |
|---|---|
| Reviewer | |
| Date | |
| Critical/high open | |
| Lower findings dispositioned | |
| Follow-up tickets | |

### paradisemodern Comms surface (C3.13)

Paradise Comms is Paradise Modern's hosted voice/video relay, one of two
interchangeable providers with Daily and not preselected
(owner decisions 2026-09-27 and 2026-10-22): prod `https://paradisemodern.com/v1`,
staging `https://comms-staging.paradisemodern.com/v1`; auth is a per-site
`x-api-key` (carrying comms scopes) or a legacy portfolio bearer token.
Capabilities `comms.calls/rooms/streams/conversations` are reported by
`/api/integration/capabilities`.

**Code.** The Paradise adapter —
`plugins/voice-video/paradise.ts` (HTTP client), `paradise-provider.ts`
(seam mapping), `settings.ts` (§41-encrypted secrets in module settings),
`webhook.ts` plus `app/api/plugins/voice-video/webhooks/paradise/route.ts`
(inbound relay), with `daily.ts` retained as optional non-first-party code.
**Tests.** `paradise-adapter.test.ts`, `paradise-flow.test.ts`,
`paradise-webhook.test.ts`, `daily-adapter.test.ts`, `daily-flow.test.ts`,
`plugin-claims.test.ts`, `internal-services.test.ts`, and the
unconfigured-provider browser journey.

Provider requests use a fixed HTTPS API origin, bounded bodies, timeouts and
no redirects. Room and recording identities must match the persisted
provider account. On the shipped Daily path: transcript downloads use
public-DNS-pinned transport without the API credential, private rooms
expire with separate room-bound host/guest tokens expiring within 30
minutes, provider shutdown expires the room, ejects participants and
verifies empty presence (local state alone is not accepted as that
evidence), and expiring leases reject stale provider results with provider
I/O outside database transactions. On the PM path, credentials are TTL
JWTs with TURN, room end persists terminal state and awaits LiveKit
`DeleteRoom` (`media_ended`, with 503 `media_termination_pending`
retryable), recordings land in DigitalOcean Spaces and are listed, read
and erased through the 2026-09-28 recording lifecycle (playback URL is a
public unsigned Spaces URL — a short-lived access window, never a shareable
link), webhooks are HMAC-SHA256 signed (`Webhook-Signature:
t=<ts>,v1=<hmac>`) and verified with a five-minute timestamp window before
any database effect, and the inbound relay is idempotent by envelope id in
`voice_video_webhook_deliveries`. The prepaid-budget 402 gate applies to
site-key callers and is surfaced with balance and top-up URL, never retried
past.
Token-bearing result fields use explicit `Token` names for central
redaction and never enter room/artifact list rows. Guest links are
generated for manual sharing, not sent automatically.

**Residuals.** Review the actual PM surface against a live paradisemodern
instance: credential TTL and TURN handling, room policy enforcement, the
media-termination retry, and webhook signature verification end to end.
Provider-side erasure rides `DELETE /v1/recordings/:id` (retryable 503 keeps
the PM row and the receipt pending; 409 mid-egress defers to the durable
job). Transcripts are unavailable until PM ships them. Live paradisemodern
acceptance remains C3.13 work. Review [provider erasure and recovery](../deploy/provider-recording-erasure.md),
including the PM-path honesty note and failed-job recovery. This
implementation and its mocked HTTP tests are not an independent review.

## Explicit private phase authorization (C3.22/C11.10)

The public-source crawler uses private read/apply phases and must work with an
exact public-operation key. `orchestratedBy` opts a private scoped core phase
into one same-family public operation's authorization for its original actor.
`src/core/service-orchestration.ts` bounds this to the active invocation;
`src/core/service.ts` preserves ordinary authorization, agent/human restrictions,
transaction rules and audit identity. A query operation cannot authorize a
mutation phase. Ordinary service composition, another parent or actor, plugin
phase declarations and dangling async work cannot use this binding. No key
scopes are added and no caller becomes system. Review the async lifetime and
reentrancy boundaries alongside `tests/core/orchestration-permissions.test.ts`.
This source evidence does not complete the independent review.
