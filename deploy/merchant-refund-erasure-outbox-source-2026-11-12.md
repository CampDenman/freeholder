<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original refund evidence and erasure receipt repair (C12.38/C1.08)

This isolated source slice uses the existing transactional outbox; native
qualification and its limits are recorded below.
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
artifact. It passed on the exact frozen source as recorded below. This pending-cohort case does not qualify completed-cohort
late-positive reopening, automatic restoration, actual provider-account behavior
or a full returned-cash lifecycle. The narrow proof below is required alongside the clean e2c4d4d8/SQLd060 baseline; broader lifecycle claims remain separate. Existing bank-return/state, fee/reversal, human and full lifecycle
completion remains open; the new merchant model is disabled.


## Actual corrupt-artifact and primary-money convergence

The exact native case passed6.138 seconds on frozend156d5e8 and preserved
normal-v7 SQLd060. Real shared checkout, payment/refund phases, privacy request
and retained artifact services ran against the disposable database; the real
Stripe factory used intercepted HTTP. One physical refund POST was asserted.

After the artifact was corrupted without updating its checksum, the original
refund callback still committed its500CAD succeeded raw observation, actual
resource ACK and original caller finish. The logical refund also succeeded and
the payment's refunded_minor became500. A separate read-only inspection found
one ordinal1 dispatch with an actual returned finish, one bound succeeded raw
observation, one dispatched request event and three pending ACK/money/finish
outbox repair events. Those events retain the explicit error requiring exact
original-receipt restoration. The original artifact body and previous checksum
were unchanged; the request remained in_progress with fulfilled_at NULL and
the truthful receipt-recovery resolution. Both promises, the runner and query
connections drained; database nonidle[] was verified before lane handoff.

Logs: `/tmp/freeholder-refund-outbox80-native-v7.{json,log}` and
`/tmp/freeholder-refund-outbox80-native-v7-{ledger,drain}.json`.
This proves primary-fact failure isolation and durable pending retry for an
already-pending cohort. It does not prove completed-cohort late-positive
reopening, successful artifact restoration/replay, fee/recipient/bank-state
closure, booking/subscription variants or actual provider-account acceptance.
