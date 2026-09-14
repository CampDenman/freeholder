# C11.10 independent security-review packet

This is a briefing packet for an independent reviewer. It is **not** the
review. C11.10 stays open until a reviewer who did not author the surfaces
below has resolved every critical/high finding and dispositioned every lower
one.

Prepared 2026-09-12 from the tree at this change. Threat surfaces, existing
tests, and known residuals only — no claim that the list is empty.

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
`plugin-scaffold.test.ts`.

**Residuals for the reviewer.**

- Install trusts a signed index and a directory hash. Confirm a mutated
  file after install is refused on enable, not only on update.
- Plugin permissions cannot mint `network:external` (or equivalent) without
  declaring it. Importers already require that; other plugin kinds may not.
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

### Daily private calls (C3.13)

**Code.** `plugins/voice-video/daily.ts`, `adapter.ts`, `service.ts`, and the
admin voice/video actions. **Tests.** `daily-adapter.test.ts`,
`daily-flow.test.ts`, `plugin-claims.test.ts`, `internal-services.test.ts`, and
the unconfigured-provider browser journey.

Provider requests use a fixed HTTPS API origin, bounded bodies, timeouts and
no redirects. Transcript downloads use public-DNS-pinned transport without
the API credential. Room and recording identities must match the persisted
provider account. Private rooms expire; separate room-bound host/guest tokens
expire within 30 minutes. Token-bearing result fields use explicit `Token`
names for central redaction and never enter room/artifact list rows. Guest
links are generated for manual sharing, not sent automatically. Provider
shutdown expires the room, ejects participants and verifies empty presence;
local state alone is not accepted as that evidence. Expiring leases reject
stale provider results, with provider I/O outside database transactions.

**Residuals.** Review actual Daily token/recording behavior and access-link
handling against a live domain. Recording bytes remain at Daily; local contact
erasure does not yet delete provider recordings or expired room metadata.
Owner-storage import and provider-side erasure remain C3.13 requirements.
This implementation and its mocked HTTP tests are not an independent review.
