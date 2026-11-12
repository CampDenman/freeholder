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
existing owning records. Address minimization rereads current direct and
inherited holds under the contact identity lock, using retained consent or the
original erasure request to establish ownership. A legacy orphan with unknown
ownership stays preserved while a named hold could cover it. A retention
runner's earlier exemption snapshot cannot authorize forgetting a later hold.

Native tests use a fake HTTP carrier and a disposable PostgreSQL database. They
cannot satisfy C3.31's actual transactional and bulk sends, independent security
review or any hosted-preview acceptance.

A later consent outcome can contradict an earlier withdrawal confirmation, even
when the address and original erasure were already completed. The new observed
HTTP fact commits first. A separate durable recovery debt reopens the original
request through its retained request link; the periodic worker repairs a crash
between those commits. The original withdrawal timestamp, first human receipt,
and observed operations remain intact. New human reviews append private keyed
receipts covering the exact current operation facts. An erased address remains
blank: recovery requires fresh original-provider evidence for that exact receipt,
and never reconstructs an address or sends it to a replacement account. Missing
or corrupt original erasure artifacts stay in progress until restored; newer
provider proof cannot fabricate the original scope or clear that recovery debt.

Local qualification on the media75 integration source: the complete journal
0–76 applied to a fresh disposable database (77 entries). The true new physical
consent-after-completed-erasure regression and the earlier late-ACK positive
both passed. The new regression also proves fresh independent correction can
complete the reopened request while retaining the exact first withdrawal and
both private review receipts. Full composed qualification remains required.

The adjacent ordering where a human withdrawal predates erasure also reproduced
a missing original-request link. Fulfillment now captures that actual owning
request before minimizing a finished grant. The bounded after control passed;
the original failure remains recorded. A populated journal75-to76 upgrade also
preserved six original contact/consent/mail tables' row values while adding only
empty or unknown carrier metadata for history. The live SDK's eight controls and
the five internal-service boundary controls passed. These are local source
proofs, not a stable release or provider-account sign-off.
