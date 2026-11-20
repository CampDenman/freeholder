<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact controlled canonical receipt batch writer

Checklist: MASTER §43 C12.38/C1.08/C9.33/C9.38. SOURCE ONLY in an isolated
descendant of3ac1c398. No execution, compilation, lint, tests, parser, database,
provider or native acceptance ran. The future six models remain outside
current142 qualification. The writer is an ordinary UNREGISTERED function;
missing genuine private application authority refuses before any database work.

The structural plan retains explicit actual receipt UUIDs and exact controlled
origin/resource/accepted bank invoice FKs. It refuses duplicate receipt, intent
or charge identities, foreign owners/currency/namespace, unresolved reserved
routes and overage. A real already succeeded payment is discovered only through
merchant_agreement_payment_routes.original_charge_receipt_id, never by amount.
Every new receipt gets one deterministic receipt/collection-bound payment key.
One-cent and partial batches preserve every unpaid cent after independent
original cash and issued credit. No receipt is clipped or reused.

The ordinary writer acquires contact identity, actual resource and subscription
parent before canonical payment/invoice/note/cash locks. It reauthenticates
the actual server-retained cash fact, original operation and caller. Complete
retained observations and one combined5000 table+ID+full-row-SHA parent budget
remain required. It calls the genuine private application query for every new
receipt before the first write, rechecks the whole batch unchanged and records
the composite batch revision. It obtains and repeats current genuine authority
immediately before each receipt's FIRST canonical mutation. The transaction
marker is exactly {collectionId,receiptId,revision}, private to that real SQL
transaction; it is not a public override or replacement for proof.

Each actual receipt uses the existing shared createPayment → authentic retained
recordMerchantPaymentObservation → settlePayment sequence with its REAL amount,
currency and PI, all through ctx.callAsSystem in the caller's SAME transaction.
There is no bank POST, synthetic ServiceContext, guessed receipt.paymentId,
return intent, fee-settlement flag or direct access grant. It never requests a
new bank proof after its own staged created-payment row, which current producer
proof would legitimately refuse. Later receipts obtain fresh authority against
the earlier REAL canonical payments. Any refusal propagates; the actual outer
mutation must not catch and commit it. The normal shared service transaction
must roll back the entire batch and its queued effects. Invoice cash/credit/
total/refund projections are independently re-read at the end. Partial batches
must remain unpaid; only actual full consideration may produce the spine's
normal invoice.paid event.

Seventeen prepared pure plan controls cover tiny/partial receipts, distinct
equal-valued receipt identity, deterministic keys, exact route/payment reuse,
already applied idempotency, seven foreign/missing owner cases, three duplicate
identity cases, reserved routes, whole overage preservation and foreign payment
or receipt FKs. These use explicit MOCK projections and are all UNRUN. They
do not prove current bank ownership or actual PostgreSQL rollback.

Still required: Carrier's frozen genuine current observation admission and
finished charge/refund/dispute proof; the full typed prospective context through
actual financial predicates for both pending and earlier newly canonical
receipts; private authority registration and exact producer routing branch;
installed alternate-writer/callback transition fences; real public canonical
factory; actual later-receipt-refusal rollback, partial/no-paid-effect,
duplicate/foreign/currency/overage before-write and unchanged-default native
controls. Those controls cannot honestly reach this new path until its real
producer exists. No fake fixture/backfilled rows/context is substituted. Full
source/schema/native/provider/privacy qualification remains required. No SQL,
models, journal, existing default route, deployment or stable state changed.
