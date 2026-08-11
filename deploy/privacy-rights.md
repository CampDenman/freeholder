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
