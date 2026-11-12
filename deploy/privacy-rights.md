# Privacy-rights operations

Freeholder's C1.08 workflow turns consent and privacy requests into durable,
auditable records. This is an operating guide, not legal advice: the owner is
responsible for choosing the applicable jurisdiction, confirming identity,
and documenting any reason data must be retained.

## Surfaces and authority

- `/admin/contacts/privacy` is the contacts-scoped owner/staff desk. `view`
  grants can inspect; `manage` grants can record consent and handle requests.
- `/portal/privacy` is personal to the authenticated customer Contact. A portal
  request is marked verified because the one-use login already proved control
  of that Contact's email. A staff-entered request remains `submitted` until a
  human records the verification method.
- `/privacy/artifacts/<id>` delivers a JSON file only after session and
  ownership/contacts-manage checks. It sets `private, no-store`, no-referrer,
  nosniff, a restrictive sandbox CSP, an attachment filename, and its SHA-256.
  An artifact is never copied into the public media bucket.
- The registered services are the same HTTP API, OpenAPI and MCP contract used
  by the UI. Agents cannot call personal `privacy.*` services, and the
  step-up-protected fulfil operation rejects API keys.

The default `response_due_at` is a conservative 30-day operational follow-up
target. It is deliberately described that way in the UI; it is not a claim
that every jurisdiction has the same deadline.

## Consent contract

`consent_records` is append-only evidence, not a mutable boolean. The effective
choice is the newest purpose/channel record whose expiry has not passed.
Purpose/channel constraints permit marketing email/SMS/push, analytics on the
web channel, and channel-free data processing. Each row records state, method,
time, terms version, collection URL, trusted request IP when available, bounded
evidence, expiry and actor.

The customer preference centre appends a new email, SMS or push decision. It
never edits old evidence. Future send paths must call
`contacts.canContact`; C7.12 is the completion item that makes every messaging
carrier and STOP/START flow converge on that check.

The demo seed deliberately creates no consent decisions, identity checks,
legal bases, or completed privacy requests. Fabricating any of those would
turn sample data into evidence the operator could mistake for real. The empty
states and contextual help are therefore the safe first-run experience.

## Request lifecycle

1. `submitted`: staff recorded the request, but identity is not yet verified.
2. `verified`: a portal session proved identity, or staff documented the check.
3. `in_progress`: staff explicitly claimed handling. A verified request may
   also be fulfilled directly.
4. `completed`, `partially_completed`, `denied`, or `cancelled`: terminal.

PostgreSQL checks prevent impossible verified/completed rows, and status
updates are conditional. Fulfilment takes a transaction-scoped advisory lock,
so two workers cannot create two outcomes. Access and export create a canonical
JSON file containing the Contact profile, consent evidence, request records,
audit/timeline information, and every enabled module's registered data.
Correction accepts only the bounded Contact profile fields shown in the desk.

Erasure requires a fresh 2FA step-up and the literal confirmation `ERASE`.
Within one transaction it:

- scrubs the Contact, timeline payloads and applicable audit diffs;
- removes relationships and one-use customer links;
- deletes a customer-only login and all cascading sessions/credentials, while
  refusing to delete any staff-capable login;
- anonymizes form answers and unlinkably pseudonymizes analytics events while
  preserving non-personal aggregate counts;
- redacts duplicate/merge snapshots and makes affected merges non-undoable;
- removes earlier export artifacts and scrubs privacy-record free text;
- appends marketing-withdrawal suppression evidence for email, SMS and push;
- creates a minimal erasure receipt and emits timeline/outbox evidence.

## Merge history and subject identity

Active transitive merges form one privacy subject. Undo separates those subjects
again. Exports include only a snapshot or historical payload that belongs wholly
to the current subject; shared payloads are redacted, and owner-only merge recovery
checkpoints are excluded. Erasure also removes the subject's personal data from
shared historical snapshots, timeline payloads and audit differences, including
nested merges later undone. A separate other person's before-image remains intact.
Affected recovery checkpoints are cleared and their merges become non-undoable.

Stored action identifiers, record dates and contact references remain as
operational history; the existing login-actor anonymization still applies. A subject export masks historical contact identifiers that
belong to a separate party; erasure clears applicable personal payloads rather
than rewriting transaction history. Existing scope-specific retention exceptions
still apply independently. A hold on `contact.merge_history` does not retain an
unheld `contact.audit` or `contact.timeline` payload.

Merge, undo and privacy fulfilment take the same nonwaiting transaction guard
before reading identity. A competing operation receives a retryable conflict
without partially changing either identity. New audit, timeline and merge points
use the actual operation time so nested operations in one transaction remain
ordered. Legacy transaction-start timestamps can be ambiguous; shared historical
payloads are conservatively redacted rather than attributed to a separate person.

The real PostgreSQL controls are in
`tests/core/contact-privacy-lineage.test.ts`. They cover transitive and undone
merges, borrowed addresses, other-party recovery data, named holds, exact audit
scrubbing, timeline payloads, composed transactions and competing identity work.
These source repairs do not supply the independent C11.10 review.

## Payment-provider customer cleanup

The existing `commerce.money` scope includes both local payment data and its
merchant-owned provider customer copies. Before deleting local customer/card
rows, fulfilment queues one durable task per original provider/account/customer,
including a customer known only from a saved method. The receipt stays
`in_progress` until every task acknowledges actual cleanup. A documented hold
on `commerce.money` retains both the provider work and its local references.

`invoicing.eraseProviderCustomer` retries the original account and logical job
identity outside a service transaction. Stripe must first identify that exact
customer, then return its deletion acknowledgement; an actual already-deleted
customer is a successful replay. An outage, wrong identity, denied original
account or unsupported provider leaves the task pending for repair/retry. No
request falls back to the platform account. Jobs retain only the minimum
provider references and request/job IDs, not the erased name or email.

Deleting a Stripe customer removes saved payment details and immediately
cancels its active Stripe subscriptions. The owner sees this consequence before
confirming `ERASE`, in English, Spanish, French and Arabic. See Stripe's
[customer deletion contract](https://docs.stripe.com/api/customers/delete).
This targets merchant customer profiles and saved methods; retained financial
records and documented exceptions remain subject to the owner's existing policy.

Provider feedback uses the same nonwaiting identity guard as erasure. A racing
settlement rolls back for retry, then records real money after cutover without
recreating the erased customer/card data. Late method-only feedback is ignored.
The shared contact update service preserves the erased-source marker, including
a field edit prepared before erasure: the final write checks the current marker
atomically and refuses an overwrite. A new relationship uses a new Contact.
Inspect failed/dead-letter work in `/admin/jobs`; repairing credentials or
original account access and retrying preserves the original privacy task.
Provider HTTP fixtures and disposable database checks are source evidence;
actual account acceptance and independent security review remain open.

## Recovering a missing pending receipt

Only one erasure for a Contact can be handled at a time. Another request cannot
remove its pending artifact. An already-applied request with no usable pending
receipt refuses fulfilment and denial; it needs recovery of its original work.
The canonical verification marker and the immutable fulfilment audit identity
provide this fail-closed check without recovering erased personal information.

Before upgrading an existing site, the owner can run this read-only query
against their database to identify missing artifacts needing investigation:

```sql
SELECT r.id, r.status
FROM data_requests r
WHERE r.kind = 'erasure' AND r.status = 'in_progress'
  AND NOT EXISTS (
    SELECT 1 FROM data_request_artifacts a WHERE a.data_request_id = r.id
  )
  AND (
    r.verification_method = 'identity verified before erasure'
    OR EXISTS (
      SELECT 1 FROM audit_log l
      WHERE l.action = 'contacts.fulfillDataRequest'
        AND l.subject_type = 'dataRequest' AND l.subject_id = r.id::text
    )
  );
```

Restore only the exact original receipt from a trusted backup after verifying
its SHA-256, request identity and original task identities. Preserve its receipt
ID and contents, then repair/redrive the original durable provider tasks through
the existing job controls. The normal worker acknowledgement must establish the
actual cleanup outcome before completion. A missing backup or unavailable
provider proof remains unresolved; do not invent a replacement receipt, infer
success from elapsed time or a missing lookup, or directly mark the request
complete. The database regression restores a checksum-verified original receipt
and then exercises the original task against a synthetic Stripe deletion
acknowledgement; it does not supply production recovery or provider acceptance.

## Legal-retention exceptions

An exception belongs to one open erasure request and one registered scope. It
requires a reason (`legal_obligation`, `legal_claim`,
`contractual_obligation`, `accounting_tax`, or `security_fraud`), a written
legal basis, the actor, and an optional future expiry. The erasure receipt names
every retained scope and the request becomes `partially_completed`. Free-form
notes are scrubbed during erasure; the minimum basis needed to explain the
retention remains.

Do not use an exception as a general hold. Name only the data scope the reason
actually covers and remove or expire it when the reason ends.

## Module completeness contract

Any module that adds a foreign key to `contacts.id` must register both:

1. `registerContactReference(...)` for merge and safe merge undo; and
2. `registerContactPrivacySource(...)` with physical table names, export logic,
   and erasure/anonymization logic.

`tests/core/merge-completeness.test.ts` reflects the live manifest and fails if
either list misses a table. Indirect personal data without a Contact foreign key
must still be registered deliberately when introduced.

## Retention, backup, and recovery

The daily `core.prunePrivacyArtifacts` job deletes protected artifacts after
their 30-day delivery window. The request record and checksum remain as audit
evidence; the file body does not. Normal PostgreSQL backup/restore includes all
four privacy tables. Before deploying migration `0024_contact-privacy-rights`,
take the ordinary verified database backup. The migration is additive: rollback
the application first if needed; keep the new tables until the prior version is
stable, because dropping them would destroy evidence.

The migration, service, permission, module-completeness, route-header,
cross-customer, correction, erasure, legal-exception, merge-undo, artifact
expiry and PostgreSQL constraint proofs live in
`tests/core/contact-privacy-rights.test.ts` and
`tests/core/merge-completeness.test.ts`.

## Threat model

An erased contact is a retained erasure boundary, not a duplicate to fold into
a returning customer's new relationship. `contacts.merge` refuses either
erased participant before changing candidates, pointers or snapshots. Keep the
new contact separate. This also prevents retained invoices moving late provider
feedback onto a fresh identity and recreating erased customer bindings; actual
late money still records on the original financial ledger. The same refusal
applies to the duplicate desk, ordinary admin merge, HTTP and MCP.

The cutover repair passed 37 provider/duplicate-review/privacy-lineage controls
plus three final typed-refusal reruns, full fast gates: 373 contracts with one
deliberate exclusion, and four actual Chromium locale journeys. The UI checks
exercise both merge directions and duplicate-desk refusal, preserve the open
candidate and both identities, and cover keyboard, 320px and both-theme Axe.
The current-main production artifact contains 19,445 files / 238,812,230 bytes and passes
the standalone source/environment scrub. These engineering checks and bounded
agent peer review do not supply independent security sign-off.

After archive integration, only the independent review-packet append required
resolution; both full sections remain. Against the computed automatic merge
tree, runtime, SQL and locales are unchanged. The composed source passed the
live SDK's eight checks and all three cutover regressions, four actual locale
browser journeys, full fast gates and the production scrub above. Fresh
exact-head protected checks still govern merge-queue admission.

- **Artifact disclosure:** authenticated delivery, exact Contact ownership,
  contacts-manage authority, short retention, no public URL and no-store
  headers. Other customers receive the same not-found response as a missing
  artifact.
- **Forged consent evidence:** source IP comes only from sanitized proxy/request
  metadata, never form JSON; actors, audit entries and immutable history show
  who recorded each decision.
- **Premature erasure:** identity verification, fresh step-up, literal typed
  confirmation, one transaction, staff-login refusal and named exceptions.
- **Partial module erasure:** the reflected registry gate fails the build when
  a Contact foreign key lacks export/erasure handling.
- **Race/replay:** conditional state transitions and a transaction advisory lock
  serialize fulfilment; the unique artifact-per-request index prevents a second
  delivery record.
- **Secrets in exports:** magic-link/session token hashes and encrypted
  credentials are never selected. The service wrapper also redacts secret-like
  inputs before audit persistence.

The workflow reflects the product obligations behind GDPR access,
rectification, erasure and demonstrable consent; CASL consent/unsubscribe
evidence; and California access/correction/deletion handling. Operators must
still obtain jurisdiction-specific advice for their business and retained
financial records.

Primary references checked for this implementation (2026-08-11):

- [EU GDPR Articles 7, 15, 16 and 17](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
- [CRTC guidance on complying with CASL](https://crtc.gc.ca/eng/com500/guide.htm)
- [CRTC CASL frequently asked questions](https://crtc.gc.ca/eng/com500/faq500.htm)
- [California Privacy Protection Agency FAQ](https://cppa.ca.gov/faq)

## Card-setup requests still in flight

`subscriptions.cardSetups` retains the immutable original setup input and each
physical provider dispatch until its actual outcome is settled. It inherits an
active `commerce.money` retention exception. Otherwise erasure marks the attempt,
prevents new caller dispatches and queues `subscriptions.eraseTrialSetupCustomers`
with the original privacy task identity. The receipt stays pending while a
physical call is running/unknown, including a rejected provider promise whose
actual remote result remains unknown.

A late successful response records its real original-account customer privately
before human business application is refused. Cleanup then deletes every actual
customer reference and removes the private setup copies before acknowledging
its own task. Unsupported providers, wrong identities, outages and unresolved
calls stay pending. A positive resource lookup, elapsed request-key window or an
empty search does not prove that all callers have stopped.

For operational recovery, open the subscription from `/admin/subscriptions` and
verify your identity. Obtain the provider's actual final operation/support
record for that exact request and original account, plus evidence that every
original caller and retry stopped. Record those concrete references and evidence
in the recovery form. Completed resources undergo positive original-account
metadata checks. Cancellation needs an actual provider guarantee that the exact
operation created no resource and cannot complete later. The result is labeled
human-confirmed and retains that human's audit identity; a checkbox, generic
assurance, time or absence is insufficient. If proof is unavailable, keep the
request pending and retain its evidence. Retry the original cleanup job only
after the actual outstanding outcomes are reconciled.

Recovery's full provider/stopped-caller evidence stays in that private source
until its hold or completed cleanup permits deletion. Typed audit projection
keeps only operation identities/outcomes in the generic audit copy, preserving
actor/action/subject history without recreating erased evidence after cutover.

## Held member parents (C1.08/C12.15, 2026-11-11)

A named `members` hold preserves the original member records and their inert
login parent. Erasure still removes ordinary contact details and all sign-in
material: sessions, password, TOTP/passkeys, reset/recovery challenges and
personal API-key access. The original contact retains only its login ID so
later owner-driven erasure can find those held records. The login's email is
replaced by a non-deliverable erased identity. This does not create another CRM
contact or transfer ownership to a later holder of the original email address.
Keeping only the login parent does not preserve an unheld payout-account copy;
member erasure explicitly removes that mutable account without relying on a
later login-deletion cascade.

Active named holds apply across this contact's requests. Creating another
request does not release or bypass an earlier hold. The request detail lists
those inherited holds; the receipt identifies the original exception/request,
and storage retain callbacks keep that originating hold identity. Explicit
removal or expiry is still required before held data can be erased.
When several requests hold the same scope, every original hold reaches the
source keeper. A newer short hold cannot replace an older continuing hold.
Hold changes take the same identity-then-request lock order as fulfilment.

Session and personal-key issuance lock the parent before consulting its erased
contact marker. An authenticated request already in flight cannot issue a new
credential after cutover. Verification also refuses a late personal key written
by an older image, even though the inert login parent still exists.

The retained profile is suspended, conversation seats remain as historical
`left` rows, and active call seats end with the existing generation rotation
and after-commit SFU retirement. Held content is not deleted by that access
revocation. A new session or owner reactivation cannot reopen an erased login.

The request remains partially completed and names its retained scope. After
resolving and removing the specific hold, the owner creates and verifies a new
erasure request; it follows the preserved contact/login link and applies the
normal member erasure before deleting the parent. A hold is never released
merely because time passed or an unrelated request completed. Staff-capable
logins retain the existing refusal and require deliberate reassignment first.

`tests/modules/member-held-login.test.ts` contains actual PostgreSQL controls
for retained seller products/accounts, revoked login routes, released-hold
redrive and preserved call history with removed call/MLS entitlement. These
coding-agent checks do not supply the independent review or live SFU acceptance.

## Selective cleanup inside a retained source (C1.08/C3.47)

A registered source may opt into `eraseUnheld`. The shared erasure service first
validates every original active hold through existing `retain` callbacks, then
invokes this cleanup once with the real current request ID and parent service
context. `retain` continues to receive each hold's original request ID; those
identities must never be substituted for the current erasure request.

The source must exclude every currently held original generation, queue actual
post-commit work in that same parent transaction, and return its real job IDs.
A retained outcome with pending jobs keeps the request in progress. The source
worker acknowledges only its own completed task; the receipt preserves its
retention outcome and exceptions when the final job finishes. Actual selective
acknowledgements remain in the receipt so a completed evidence replay is a no-op.
Missing acknowledgement history requires recovery rather than inferred success.

Only sources opting into selective cleanup may reopen a retained outcome for
new domain-validated unheld evidence. The receipt retains the legal exceptions
and becomes pending again. Other retained sources retain their existing behavior.
This code-only draft has not yet passed source/native/domain qualification.
The original known-empty upload control failed on unchanged current270 in10.12s;
its source2128, observations and log are preserved. The disposable before database
was subsequently reused; no populated-before database restoration is claimed.
