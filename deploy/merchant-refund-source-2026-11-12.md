<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant refund source evidence — C12.38/C12.26

This is unreleased source qualification. The new merchant model stays disabled.
It does not supply actual provider-account acceptance, an independent security
review, full refund integration, or a stable-release sign-off.

## Original cash and provider transport

The Stripe adapter has a separate, optional original-cash refund operation.
Its caller supplies exactly one existing cash owner: a local payment or an
original subscription charge receipt. Scheduled cash can therefore be returned
before a local invoice/payment exists, without manufacturing either object.
All reads and the physical POST preserve the original platform, actual charge
namespace and frozen API version. Destination refunds use the platform charge
namespace; settlement merchant identity does not change that namespace.

Admission freezes the exact URL-encoded body. The adapter compares that body
before any provider request and sends exactly that string and idempotency key.
It commits the actual returned refund reference through a required callback
before parsing monetary/application evidence. A malformed later field cannot
silently erase the physical resource ACK. Customer refunds omit automatic
application-fee and transfer-reversal flags; their separate recovery remains
required. This source method does not authorize a caller or claim that a
physical request may be repeated.

Recovery retains every authenticated original-account refund found on the
original PaymentIntent, including dashboard refunds with no matching metadata.
Those observations remain unassigned; mutable metadata alone does not prove
which original physical caller created them. Exact already-retained resource
ACKs still allow recovery after metadata is removed. Nullable PaymentIntent
linkage and status, raw requires_action/canceled status, and actual bank-return
references are retained alongside the adapter's normalized logical outcome.
No complete empty list proves an unknown refund was absent.

## Capacity evidence

The pure capacity calculation counts physical refund resources once, retains
extra/contradictory money beyond logical invoice caps, reserves unknown and
customer-action outcomes, and retains unfinished-creator debt after a positive
refund. It cannot choose between contradictory monetary facts or treat an
unbound cancellation as released cash. A later refund failure/action after a
success remains recovery debt; this increment does not supply a complete bank
return reconciliation protocol.

## Qualification and limits

On the isolated refund worktree, explicit Node22.23.2 full TypeScript and
changed-file lint pass. The bounded no-database run passes34 controls:
12 capacity cases and22 real Stripe-factory controls using intercepted HTTP.
They prove original direct/destination headers, one POST, body/key binding,
ACK-before-money callback ordering, nullable fields, existing receipt ownership,
dashboard preservation and original-platform refusal. These are simulated HTTP
responses, not Stripe sandbox or live-account acceptance.

The first run stopped at a new scheduled-list fixture that incorrectly returned
a Refund object instead of Stripe's paginated data envelope. Only that fixture
shape changed. Lint also required explicit string narrowing for provider status
and the encoded body. The subsequent34-control run passes; these failures are
not reported as product defects.

The isolated unregistered service/schema drafts are not part of this adapter
checkpoint or the normal80 journal. Return reservation versus ordinary payment
application must share the original-cash advisory lock, with no reverse lock
order against subscription parent retention. The durable caller/finish/stop,
original cash bindings, fee/recipient/dispute debt, atomic applied-versus-returned
disposition, refund UI/API/MCP parity, populated upgrade and full native/browser
qualification remain required before activation. Current qualified v6 SQL80
remains unchanged.

Primary references checked2026-11-12:
[Stripe Refund object](https://docs.stripe.com/api/refunds/object),
[Stripe refund behavior](https://docs.stripe.com/refunds), and
[Stripe refund creation](https://docs.stripe.com/api/refunds/create).

## Read-only returned-cash evidence increment

A separate optional original-account inspection now records the actual primary
PaymentIntent before any charge/fee/transfer read, and each actual refund before
the next refund page or fee/transfer/dispute read. It never POSTs or infers a
zero refund from a missing record. Complete current refund/dispute inventory is
explicit; omitted fee/transfer fields remain unknown, distinct from a real
provider null. Application fees and transfers are read on the original platform,
while direct charge/refund/dispute objects stay in their connected namespace.
Every request retains the frozen protocol version.

The pure return predicate requires the original terminal PaymentIntent with
zero capturable remainder, actual captured/refunded charge amount, successful
original refund resources totaling exactly the original cash, the entire actual
application fee returned, the entire actual destination transfer reversed, and
no unresolved actual dispute. Fee/transfer returns are checked in their own
observed currencies without inventing an FX conversion. It also requires
separate truthful caller-finish and unchanged-inventory predicates; the pure
function cannot establish either itself.

Explicit Node22 full TypeScript and focused lint pass, with52 controls across
four no-database files: the prior34 plus10 return-proof and8 real-factory GET
controls. The only source-gate correction was replacing two lint-forbidden
import() type annotations with an ordinary type import. This supplies no native
cash disposition, provider-account acceptance or privacy-completion claim.

The private draft application/return phases remain unregistered. Their actual
cash lock, admitted-writer snapshot, inspection-owned observations, versioned
return resolution, late contradictory facts, fee/reversal caller completion,
SQL alternate-writer guards and full source/native/UI integration must still
qualify before returning an applied/returned disposition to a real lifecycle.

## Unregistered shared-core phase checkpoint

At isolated checkpoint014c6939, eleven separate core source files defined the original cash owner, common
refund-reservation capture, one physical refund caller/ACK/finish, return
inspection admission, primary/state capture, actual read completion and versioned
cash disposition. Full explicit Node22 TypeScript and changed-file lint pass.
At that checkpoint they were not registered, called by the refund core, or
included in the assembled80 SQL. They supplied no native qualification.
The later isolated prototype wiring below supersedes the uncalled status only.

Return and payment application share the original platform/charge-namespace/PI
advisory lock. Existing reservations without a captured original request are not
silently adopted. Planned common createRefund integration covers prepared
return batches as well as direct owner actions. Opaque source FKs use the
existing payment or subscription cash receipt; human free-text reasons are not
copied into a second ledger, and no private customer/contact record is added.

A return inspection binds its exact source/caller inventory. Its own independent
observations are excluded from that admission snapshot and separately bound by
an own-evidence digest. A sequential state ledger prevents selecting an earlier
optimistic state after a later contradictory state. Finalization requires the
actual finished read promise, quiesced creation callers, unchanged source
inventory, complete raw return proof and un-applied cash under the shared lock.
Later outside or own observations invalidate a prior closure instead of
rewriting financial facts. Versioned return receipts support fresh reinspection.

Recorded fee operations currently remain unresolved in this draft unless their
separate actual physical-caller proof is integrated. Fee/reversal automation,
bank-return state recovery, alternate-writer SQL guards, privacy reopening and
periodic crash-window repair, human recovery surfaces and full native/browser
acceptance remain active completion work. This conservative intermediate state
is not a feature deferral or permission to activate the new model.

## Actual current-source physical-refund caller before control

On product0ecf99d1 plus test-only328fa48f, the normal80 v6 database (SQL SHA256
ea06fa49df88e7e3ab396c4246a5d9d017682825f0758253024be0dbcf943fd0) completed an
actual current seller checkout and canonical payment capture. The real Stripe
refund factory then sent a second identical refund POST while its first HTTP
caller remained paused. Exact body and idempotency-key equality assertions
passed; the caller-admission assertion failed after5.672 seconds.

The intercepted provider returned one successful original refund and a409
idempotency-in-use response for the concurrent call. No second customer refund
was invented or claimed. Both promises were released and awaited; the runner
exited and read-only database inspection found no active test sessions. This
proves a development-source caller fence is missing, not that Stripe would
refund twice inside its idempotency window, and not an actual-main breach.
The unregistered refund phase repair was not applied to this before source.
Logs: /tmp/freeholder-refund-caller-before-v6.json and .log.


## Isolated shared-refund fence wiring

The isolated repair now captures every newly inserted merchant refund in the
shared createRefund transaction, including prepared return batches. It delegates
the existing authorized submitProviderRefund action to one immutable physical
POST and independent ACK/money/finish phases. The common cancel/fail/start/settle
mutations check original admission and evidence; cancelling a local row cannot
free a physically admitted unknown request. An unadmitted reservation can be
retired under the same cash lock. A retry uses the captured original provider
key/body and never creates a replacement merely because a time window elapsed.
New physical keys are generated once for new captured operations, independently
of their caller's logical idempotency key; no existing operation is rekeyed.

Each admitted refund must resolve to its actual strongly bound resource or
verified terminal proof before a full cash-return lifecycle can close. A complete
charge-refunded projection alone does not settle an unidentified original
request. Generic error strings and empty lookups are not no-effect proof.

Full explicit Node22 types and focused lint pass for the isolated wiring. The
first attempt stopped at a mechanical inline-comment syntax error, corrected
without changing business behavior or assertions; the bounded retry passes.
The52 edge/proof controls passed before that correction and were not repeated.
No refund native after-control, normal SQL80 addition, table/registry metadata,
provider acceptance or enabled-model claim is supplied by this checkpoint.
Requires_action/bank-return state transitions, fees/reversals, privacy repair,
all ordinary and prepared-refund flows and human surfaces remain completion work.
