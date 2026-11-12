<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original carrier consent and withdrawal recovery

C3.31 keeps the message caller separate from each Paradise HTTP request. The
first send, consent recording, second send and withdrawal each commit a durable
intent before provider I/O. Their keyed request/resource receipts and observed
outcomes live on the existing private dispatch and grant records. After confirmed, unheld erasure the address is removed and only
minimal keyed operation receipts remain, so an original late reply can still be
retained without restoring erased personal data. A new consent
intent retains the original address before the request, even if its reply or the
following send reply is lost. This is not proof of a live send.

New grants bind the original normalized API base and a keyed credential receipt.
Credentials are used only in memory. Replacing the API key or base cannot silently
withdraw a prior account's grant. Restore the original configuration or verify
the original account independently. A credential rotation can require review even
when the provider account remains the same; the application does not infer account
identity from a new credential. No migration binds old grants to today's account.

The withdrawal job claims each HTTP request once. A permanent refusal, timeout,
server error or lost reply remains pending, retains the address/resource witness,
and cannot complete an erasure or age out through retention. Having credentials
configured is not proof that the next sweep will finish it. The site's own
marketing-consent ledger still blocks campaigns after an unsubscribe.

A freshly verified person with mail management access can open
`/admin/retention/mail/carriers`. It shows the original base when retained and
individual HTTP states, without private digests or credentials. Final withdrawal
confirmation requires the exact current grant revision and address, evidence of
the original resource, its exact final provider result/reference and proof that
all original callers have stopped. The audited service is unavailable to system,
plugin and API-key actors. Evidence prose is reduced to a private keyed receipt;
it is not copied into audit input. Human evidence never changes the observed HTTP
journal or fills a missing legacy resource binding. No provider request is made
by this confirmation.

A caller still marked running needs positive stopped-caller proof and the
original provider's final result before this form may be confirmed. Its observed
HTTP state is never rewritten into an invented success. Do not clear a running
claim because its lease or a clock expired, and do not use a provider search with
no result as proof of withdrawal. Preserve the
matching database, private receipt key and wrapping configuration. Unknown outcomes
must remain pending until their original evidence is resolved.

Migration `0076_mail_carrier_operations.sql` is a breaking writer fence: unresolved
grants cannot be deleted, original addresses/resources and observed final HTTP
outcomes cannot be rewritten by a previous image. The physical address column is
renamed so the previous withdrawal worker's initial read fails before provider
I/O; new Paradise mail claims also require the carrier writer capability. Roll back with the matching
pre-migration database and private configuration; do not run an old image against
the migrated database. Retention and named privacy holds continue to govern the
existing owning records.

Native tests use a fake HTTP carrier and a disposable PostgreSQL database. They
cannot satisfy C3.31's actual transactional and bulk sends, independent security
review or any hosted-preview acceptance.
