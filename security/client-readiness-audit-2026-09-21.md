<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Client readiness audit — 2026-09-21

**Decision: do not launch unrestricted client production sites from this revision yet.**

Reviewed GitHub `main`, commit `5ed65b12f47d23fead0434a3b5e2dd7f8d7872af`.
`git pull --ff-only github main` succeeded and reported already up to date.
The original working tree was clean. This report is audit evidence, not a
replacement roadmap, product-completion claim, or independent security sign-off.
`MASTER.md` §43 remains authoritative.

## Findings

### Repair verification

Completed targeted runs contain 150 distinct passing tests after fixes and
reruns. These cover the nine security regressions (including legacy event rows),
bootstrap/proxy trust, concurrent form submission, failed-login accounting,
free-event admission, updater refusal, deployment recipes, scaffolding, SDK
generation, localization, admin update controls, and documentation contracts.
Selected runs deliberately skip unrelated tests; this is not a full-suite result.
The earlier waitlist suite also produced 25 passing checks before the broader
run was stopped under resource pressure.

Changed-file lint (including the final edits), the plan gate, license gate, shell syntax checks and
`git diff --check` passed during repair. Full production build and final type
checking remain **unverified**: repeated local attempts were stopped under
severe memory contention; the final build stayed in compilation for roughly
20 minutes without a result. No container/provider deployment or live payment/email
integration was performed. A Windows-only documentation parser failure was
fixed by normalizing CRLF before matching the documented strike records.

**Repair status:** The working-tree repair closes the public waitlist disclosure,
first-owner takeover, referral attribution forgery, concurrent loyalty redemption,
shared login/form bucket denial, and ignored self-host image override. Referral
invitation acceptance is also restricted to its intended recipient or authorized
user. Event capacity changes share a session lock.

Paid event enrollment and automatic update/rollback execution are disabled, not
declared complete. They now fail before granting admission or claiming a backup,
deployment, or recovery. MASTER.md reopens C6.11, C10.06, and C10.10 for the missing
payment and host-executor work. Deployment requirements and limitations are in
`deploy/client-readiness.md`. The findings below preserve evidence from the
original audited commit; they are not a claim that the repaired code still has
the same behavior.

Priority 1 means fix before the affected production use; priority 2 means a
material integrity/availability defect that needs correction or an explicit
restriction on the affected feature.

### 1. P1 — Anonymous waitlist retries disclose stored customer notes

Source: `src/core/scheduling/waitlist.ts:82`, especially line 149.

`waitlist.join` is public. It resolves the submitted email to a Contact, then
returns an existing waiting/offered entry matching that contact, time window
and calendar. No email proof or session ownership is required. Its public
output includes `notes`, contact ID, status and offer details. Someone who knows
or guesses the customer's email and requested window can retrieve the existing
entry instead of merely receiving an acknowledgement. Calendar IDs are not
required for entries created without a calendar.

Fix: return a minimal acknowledgement from anonymous enrollment, keep existing
record details behind verified ownership or a narrowly scoped capability, and
test cross-customer retries. Review other public idempotent enrollment paths for
the same disclosure pattern.

### 2. P1 — Exposed fresh instances can be claimed by the first stranger

Source: `src/core/auth/service.ts:76`; `app/api/setup/owner/route.ts`;
`deploy/digitalocean-droplet/README.md:86`.

Owner registration requires only an empty user table plus a supplied email and
password. It has no install secret, deployment proof, or local-only restriction.
The unique owner index prevents a second owner; it does not distinguish the
operator from an attacker arriving first. The documented droplet flow exposes
the site before the operator visits setup. The same public service is also
available through the generic service API, so hiding `/setup` is insufficient.

Fix: require a one-use bootstrap credential configured out of band, or complete
bootstrap behind a network access restriction before exposure. This affects new
installations, not an instance with an existing owner.

### 3. P1 — Updater recovery claims exceed what it actually performs

Sources: `src/core/update/apply.ts:39`, `:115`, `:154`;
`src/core/update/targets.ts:225`; `src/core/update/preflight.ts:163`;
`src/core/update/service.ts:386`.

Three separate problems need correction:

- `takeSnapshot` hashes the list of public table names and inserts a metadata
  row with `bytes: 64`. It does not back up schema, row contents, or media. A
  returned snapshot ID cannot restore business data.
- The automatic failure path records `status: rolled_back` even when
  `rollbackCutover()` throws. Only the log reveals the rollback failure.
- The apply service runs preflight without a signed feed; this receives an
  `ok` signature step against the current build. Recipe targets ignore the
  supplied digest in their no-op `pull()`. The flow logs `migrate` without
  applying candidate migrations and smoke-tests the running build before
  cutover. These checks do not establish candidate artifact verification or
  candidate health. Some target commands also need host tools/files absent
  from the shipped runtime image.

Fix: bind application to a verified release and immutable digest, create and
verify a recoverable backup, exercise candidate migrations and health, and
persist a distinct failure state if recovery fails. Until then, use externally
managed, tested deployments and backups; do not rely on this updater for client
recovery. The separate ownership export/backup tools are not invalidated by this
finding, but the updater does not call them here.

### 4. P1 — Docker self-host rollback ignores the requested previous image

Sources: `deploy/docker-selfhost/infra/compose.yml:6`;
`deploy/docker-selfhost/recipe.yaml`; `src/core/update/targets.ts:109`.

The recipe sets `FREEHOLDER_IMAGE=$PREVIOUS_FREEHOLDER_IMAGE` for rollback,
but Compose hardcodes `ghcr.io/campdenman/freeholder:edge`. Setting that variable
therefore does not change the app image. The documented digest pin also has no
effect. The DigitalOcean droplet Compose file correctly interpolates this
variable; the finding is specific to the Docker self-host file.

Fix: make the app image consume the pin, require a concrete previous digest for
rollback, and test the resolved Compose configuration plus an actual version
change in the rollback drill.

### 5. P2 — Loyalty redemption has a concurrent double-spend window

Source: `src/modules/loyalty/rewards-service.ts:354`, especially lines 372,
431 and 487.

The handler reads account balance, stock and per-contact redemption count before
writing, without row locks or a conditional atomic debit. Ordinary transactions
do not serialize these reads. Simultaneous authorized staff/API requests can
both pass the same checks, issue rewards and append debits; the cached balance
and stock use stale absolute values. This is an authorized-concurrency defect,
not an anonymous redemption endpoint.

Reproduced with four distinct discount rewards costing 200 points each against
one account holding 200 points: all four calls succeeded and the ledger ended
at **−600**. A test barrier synchronized the calls after their balance checks;
the real reward issuer, database transactions and coupon creation still ran.
This establishes the balance race; the related stock/count reads are source
findings, not separately reproduced overselling claims.

Fix: lock the account and reward consistently before evaluating all constraints,
use guarded stock/debit changes, and add a deterministic concurrent test proving
only the affordable/in-stock redemption succeeds.

### 6. P2 — A shared login bucket lets strangers block all customer magic links

Sources: `src/core/auth/magic-links/service.ts:165`;
`src/core/service.ts:520`; `src/core/security/rate-limit.ts`.

Every consume attempt shares the literal `customer-magic` rate-limit subject:
20 attempts per 15 minutes. Attempts are counted before token lookup, and invalid
attempts remain counted. Twenty syntactically valid random tokens exhaust the
bucket for every customer. This can be repeated every window. Successful
customers also share the same small allowance.

The public forms endpoint has a related shared quota: 30 submissions per form
per ten minutes, charged before field validation (`src/modules/forms/service.ts:498`).

Fix: design per-capability and trusted-source abuse limits with a suitably sized
aggregate ceiling. Forwarded IP headers need an explicit trusted-proxy policy;
accepting arbitrary caller-supplied headers is not a fix.

### 7. P2 — Anonymous referral touches can be attached to arbitrary contacts

Source: `src/modules/referrals/service.ts:237`, especially line 276.

`referrals.recordTouch` accepts a caller-provided `contactId` and writes it
without session ownership or email proof. A caller knowing a contact UUID and
an active referral code can forge that customer's attribution. Subsequent
attribution reads credit the chosen referrer. Financial impact depends on the
enabled commission/reward workflow; this audit does not claim a live payout.

Fix: derive contact identity from the authenticated user, or reserve direct
contact binding for checked internal composition. Keep anonymous touches
anonymous until verified linking.

### 8. P2 — Event registration does not validate ticket ownership or payment

Source: `src/modules/events/service.ts:533`, especially line 574;
`src/modules/events/schema.ts` (`event_registrations`).

The public service checks that a session belongs to the event, but stores the
submitted ticket ID without checking that the ticket belongs to that event or
is active. The database foreign key only checks that a ticket exists. It also
allows no ticket and confirms available seats without consulting ticket price
or collecting payment. Paid event admission cannot safely depend on this
registration status.

Fix: validate the ticket/event/active relationship, define whether a ticket is
required, and keep paid admission pending until a verified payment transition.
Test foreign, inactive, omitted and unpaid tickets.

## Verification and scope

- Latest-commit GitHub CI: **33 jobs successful**, including 24 database test
  shards, application/package/build gates, browser accessibility and journeys,
  CodeQL, dependency checks, image/recipe/upgrade checks, and the ownership drill.
  Evidence: https://github.com/CampDenman/freeholder/actions/runs/35145591977
- The published-image workflow also succeeded for the same commit:
  https://github.com/CampDenman/freeholder/actions/runs/35147177385
- Fresh local dependency audits: **no known advisories** for the root pnpm
  workspace; the separate mobile npm lockfile audit also reported **zero
  vulnerabilities** (573 dependencies).
- Local TypeScript check: **passed**.
- Local plan-consistency gate: **passed** (290 unique IDs, 272 checked, 18 open).
- Local licensing gate: **passed** (1,762 source files, eight manifests and
  eight license texts).
- Local lint: stopped during the resource-constrained run; no passing local
  result claimed. Workflow-integrity execution encountered a local `EPERM`
  opening the installed `yaml` package; its hosted CI result is successful.
- Local full database suite and production build: started, then stopped because
  of machine resource contention and slow durable resets. They are not local
  passing evidence. Latest-commit CI provides the completed full-suite/build
  evidence above.
- Final targeted reproduction run: **9/9 passed**, including the synchronized
  loyalty double spend. These passing assertions demonstrate defective
  behavior; they are not a production acceptance pass. Machine-readable
  evidence: `.work/audit-final.json`; transcript: `.work/audit-final.log`.
  Earlier attempts encountered database reset timeouts, a duplicate JSON-report
  argument, and a same-reward race masked by coupon-code uniqueness. The final
  run used a fresh isolated fixture, a single report path and distinct rewards.

Review covered the central service/HTTP permission boundary, auth/bootstrap,
customer magic links, public service declarations, selected customer-data and
commerce handlers, rate limits, upload delivery, outbound request protection,
payment orchestration, plugins/updater, deployment recipes, dependency policy,
CI and the existing security reports. It is a broad source audit with targeted
execution, not a claim that every line, provider, browser state, device or
deployment combination was independently exercised.

Local diagnostic scripts and characterization tests are in `.work/`; those
tests assert the observed defective behavior, so a passing reproduction means
the defect exists. They are not acceptance tests for a fixed application. Test
data uses dedicated `freeholder_audit_*` databases. No client deployment,
provider charge, email send, commit or push was performed.

To repeat the characterization suite, use a **new** disposable database name;
the fixture intentionally does not reset an existing database:

```powershell
$env:AUDIT_DATABASE_NAME='freeholder_audit_repeat_20260921'
node .work/audit-run.mjs --config .work/audit.config.ts --outputFile.json=.work/audit-repeat.json
```

The script uses local database credentials without printing them, creates only
the named audit database if absent, and overrides both application and test
database URLs for the child test process. Audit databases are retained for
inspection. Automatic rollback failure is simulated; no real host rollback is
executed by the reproduction.

## Launch implications

A restricted staging pilot is appropriate; unrestricted client production is
not yet supported by this audit. Fix the exposure and recovery findings before
launch, then reproduce the intended client journey on the actual hosting target
with real storage/mail configuration and a verified restore. If a pilot only
needs brochure pages and an enquiry form, explicitly restrict unused service
surfaces and validate the form's availability; omitting navigation links does
not remove public API services.

The existing completion plan still leaves C3.13 and C11.08/.10/.11/.16/.17 open.
That includes independent security review, cross-target recovery evidence,
reference-target performance and final whole-product acceptance. Existing green
tests do not waive those requirements or the concrete findings above.
