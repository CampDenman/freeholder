<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original refund evidence and erasure receipt repair (C12.38/C1.08)

This isolated source slice uses the existing transactional outbox; native
qualification remains pending.
A physical refund ACK, raw financial observation, original caller finish or
return disposition commits with a small pointer to its immutable evidence row.
No current merchant profile, email, generic policy callback or second queue
connection must succeed before that primary fact commits.

The invoicing manifest registers the named listener. Only after source commit,
its private shared query resolves the actual immutable row and its original
collection, booking or subscription profile. Zero or multiple original scopes
remain observable recovery work. It then calls the existing system-only
original-profile erasure reopener. A corrupt/missing receipt stays pending
recovery without fabricating an artifact; listener errors are retained by the
outbox's existing retries/dead letters. No new schema or queue is introduced.

Raw refund evidence admitted by an original request or inspection can be
retained even when a later commercial projection needs restoration. The primary
capture does not silently replace its original source. Financial lifecycle debt
also reads original refund child/caller evidence: a succeeded local row alone
cannot hide an unknown or contradictory original resource, and overflow blocks
completion. Payment-side unapplied returns remain pending until their complete
canonical disposition is integrated; no invented negative proof is supplied.

Full explicit Node22 TypeScript and changed-file lint now pass on the composed
source82afef04, including the previously qualified return-routing/root ownership
source. Six matching source-control files passed37 controls with one declared
DB-dependent skip; the nonexistent requested event-bus filename supplied no
coverage. The real durable outbox suite is DB-backed, and no NoDB outbox success
is claimed. Actual changelog generation produced600 changeset notes. Logs:
`/tmp/freeholder-refund-outbox80-{types,lint,contracts}-v1.log`.

The prepared native fixture uses the actual Stripe factory/intercepted HTTP,
original payment and shared refund/erasure spine. It corrupts the actual retained
artifact while the physical refund callback is paused, then requires a succeeded
raw/logical refund and durable pending outbox retry without altering that corrupt
artifact. It is UNRUN. This pending-cohort case does not qualify completed-cohort
late-positive reopening, automatic restoration, actual provider-account behavior
or a full returned-cash lifecycle. Native qualification is required before this
slice replaces the clean e2c4d4d8/SQLd060 candidate. Existing bank-return/state, fee/reversal, human and full lifecycle
completion remains open; the new merchant model is disabled.
