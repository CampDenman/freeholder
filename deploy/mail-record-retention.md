<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Mail record privacy and retention

MASTER.md §43 C3.31 remains open for live Paradise transactional and campaign
acceptance. This source repair addresses the separate legacy mail-record gap;
it supplies neither provider acceptance nor the independent security sign-off.

Admin → Retention offers `mail_deliveries`, `mail_provider_events` and
`mail_suppressions`. Policies minimize old personal fields while preserving
minimal receipts that prevent duplicate sends/events and remember releases.
Eligible subjects, recipient addresses, provider references, free-form errors
and details, and raw idempotency keys are removed. Replay matching uses
domain-separated HMACs under a random per-site key encrypted with the existing
credential wrapping. Mail status and review audit inputs expose neither private
digests nor ownership joins.

Active suppressions never expire on a retention clock. Explicit verified erasure
can remove the address while keeping its effective block. A later authenticated
provider fact can reactivate a released block without restoring plaintext.
Admin → Settings → Mail explains a minimized block; release requires typing its
independently verified original address, fresh human verification and ordinary
mail permissions. A placeholder receipt address cannot receive mail.

Queued/submitted deliveries, outstanding outboxes and multiple physical attempts
are not terminal evidence. A final-looking event does not settle a second send.
Attempted outboxes do not expire after 30 days, and a stray replayed delivery job
does not delete them. Never-dispatched outboxes can expire unless a named mail
hold protects them. A provider error alone is not proof that a send could not
complete. Outstanding evidence keeps erasure pending: elapsed time, missing
callbacks or a later retry's success are not recovery proof.

The privacy scope is `mail.records`. New records bind only to existing contacts;
provider callbacks inherit their original delivery's ownership. The join follows
contact merge/undo and survives address anonymization. Named holds protect owned
records and unsent private originals after anonymization. While a hold exists,
unknown legacy ownership is conservatively protected rather than guessed from
today's address. Sending mail does not create a second customer list.

Old address-only mail requires review at `/admin/retention/mail`. A pending
privacy request links to its original contact. The reviewer checks authoritative
correspondence and the recorded date before attributing the record. Today's
address match alone is insufficient. Agents cannot supply this fresh human
review; background system workers cannot supply it either. Only a private keyed
evidence receipt, reviewer identity and time are
stored; the evidence text and address do not enter the mutation audit. Contact
read and mail permissions still apply. Stale recipients and already-bound
records are refused. Unknown ownership keeps erasure pending until reviewed.

Erasure cancels never-dispatched mail and minimizes exact owned records in the
same transaction. Durable `core.eraseMailRecords` jobs retain record IDs and the
original privacy receipt identity. They wait for unresolved physical sends or
legacy review, cover late children of captured deliveries, and acknowledge only
the original receipt. Historical staff notification copies tied to the exact
outbox event are also covered. A disappeared mail outbox is not positive evidence
that a derived physical send settled; later retries do not settle earlier sends.
New mail notices use the existing localized address-free text. A callback's
recipient must match its original delivery. Unmatched historical feedback is
never assigned by today's contact address or creation date. A proven fresh
holder's delivery is separate from an earlier holder's minimized records.
Exports show only a generic retained block receipt when its current supporting
fact belongs to someone else. Initial erasure and old workers use that same
current-fact ownership boundary, so they cannot minimize a new holder's fact.
Completed receipt replays are no-ops; missing original records or receipts fail
closed for exact-backup recovery. If an authorized retention run already
minimized a captured candidate, recognizing that completion does not invent
historical ownership.

Migration `0071_mail_record_retention.sql` follows migration70. It adds stable
suppression IDs and private metadata without guessing legacy contact ownership.
Database guards refuse stale ownership writers and, when privacy begins or after first irreversible
minimization, old mail/outbox writers. They prevent late callbacks and stale
upserts from restoring minimized addresses or payloads. This is a declared
schema-breaking rollout: all running instances must use the guarded image.
The SQL write fences do not make an earlier application image supported on the
new schema.

Back up the database and original private wrapping configuration together.
Credential rotation tries the prior wrapping key and rewraps the same random
receipt key; it never changes receipt identity. Missing/unreadable original key
material fails closed. Restore the exact matching backup rather than generating
a new key or clearing digests. Full rollback requires the pre-upgrade database
and configuration, respecting acknowledged erasures before old data can be sent
or published again.

Local evidence (2026-11-11): actual initial and peer failures reproduced missing
policy kinds, retained personal fields, loss of multiple-attempt evidence,
callback plaintext restoration, uncertain derived mail copies, hidden retained
block exports, stale snapshot writes and nullable reviewer metadata refusal.
The final actual-main composition, based on migration 70 main `1ffec6fa`, passed
96 actual controls across eight mail routing/privacy/populated-upgrade/adjacent
suites, with no database skips. Those 96 include both system-actor refusal
controls; they are not an additional count. SDK generation passed all eight
catalog checks without drift. TypeScript, lint, licensing, plan checks and the
373-contract inventory passed, with its one documented exclusion. The production
artifact scrub passed 20,330 files /242,415,563 bytes. All four fresh-database
English/Spanish/French/Arabic owner review browser journeys passed at 320px in
both themes with keyboard, Axe, actual element bounds and real service/audit
assertions. Protected PR/merge integration remains required.

C3.31/C11.08 also require the separate enabled transactional/SMTP physical-send
recovery increment: freeze original route/request identities, journal each
physical dispatch and retain unknown legacy outcomes until concrete original
provider and stopped-caller evidence exists. This retention increment does not
invent those missing historical facts, treat submitted mail as final proof or
supply a generic unknown-outcome clearing override. These source obligations and
live-provider acceptance remain open before stable. Coding-agent evidence is
not C11.10 independent sign-off.
