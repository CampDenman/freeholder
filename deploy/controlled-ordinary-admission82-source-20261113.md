<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Ordinary collection pre-admission source checkpoint

C12.38/C9.38, source only, 2026-11-13. This isolated continuation starts at
signed35ec8b08, carries the independent buyer projection f36c69c6 as74d02c81,
and normally carries the signed narrow raw-positive9 classifier d130a89c.
No compiler/lint/tests/build/model imports/parser/PG/provider execution occurred.
No SQL/model/journal or current root worktree was edited.

`lockControlledOrdinaryCollectionParent(tx,invoiceId)` first stabilizes contact
identity for read, discovers an actual accepted collection.invoice_id, then
locks its exact controlled resource and subscription parent before the ordinary
canonical locks. Actual collection→quote→resource and invoice source IDs/kinds
are explicit. LEFT JOIN discovery deliberately retains an incomplete/foreign
parent as refusal; a missing parent cannot masquerade as no controlled target.
Multiple targets, shifted profile/version/source, wrong kind, missing resource
or parent, or changed ownership after locking refuse. No amount/email/current
account or source-prefix selection occurs. It returns ownership/lock metadata,
not payment authority. It accepts a real Tx, never a synthetic ServiceContext.

The shared new-payment creator calls this and prospective authority before its
invoice lock; idempotent existing-payment return does not authorize another POST. Physical
merchant dispatch claims call it and current authority before invoice/payment
locks; hosted checkout, authorized customer checkout, in-person claims and
stored-method proration claims do the same before their canonical writes. The
customer is authenticated before target locking. Authority is required only for
a new payment, physical POST dispatch or prospective POS cash collection; an
existing attempt remains available to its independent recovery GET path. Ordinary customer balance
application also reaches the shared creator before its normal balance write.
Actual authenticated system provider_schedule application with a real original
receipt stays on the existing signed cash application/route checks; it does
not invoke prospective new-money permission or acquire a resource after a
reconciliation parent's existing locks. Its previously retained bank facts are
never removed by a later canonical refusal. A guessed provider_schedule label
or an absent original receipt does not use that exemption. Read-only invoice
balance/due computations are unchanged and acquire no new resource locks.

`requireControlledOrdinaryCollectionAuthority` requires the installed full15
protocol and the exact private handoff name:

```
invoicing.controlledProviderOrdinaryCollectionAuthority
input: {collectionId,invoiceId,requiredProtocol:'controlled_net_gross.v1',
        provider,method,paymentId?}
output: {allowed:true,revision:64-lowercase-hex}
```

No such reader/producer is registered by this checkpoint. Missing capability
therefore mechanically refuses another ordinary method on an accepted controlled
target; it cannot borrow controlled pay_invoice permission. A future genuine
reader must bind the actual terminal/alternative disposition, full original
bank invoice/PI/payment inventory, real physical caller finish/stop, exact
current parent/capacity/fee/credit ownership and actual reviewed alternative
choice. An ACK, void flag, zero balance or current state cannot supply missing
original money/disposition. No invented UUID, synthetic actor or inferred
receipt enables this branch. A real admitted caller is never excluded.

Eight prepared real SQL-adapter controls cover complete lock order, legacy
absence, ambiguous/missing/foreign source and kind, ownership reread and contact
merge refusal. They are UNRUN. No shared native ordinary target case is claimed:
the genuine disposition producer remains REQUIRED, not deferred or silently
implemented by this handoff.

The new raw9 classifier remains strict after its carry. Retained positive
intent_read/invoice_read and unfinished/unsettled facts stay debt independently
of cash_observed/receipt application. Full15 source currently refuses all those
write-debt facts; exact approved nonpayable draft/NET/calendar treatment must
later authenticate the actual canonical target and entire current bank graph,
without blanket-clearing actual money, unexplained resources or live callers.

Still REQUIRED before a positive path or stable claim: authentic terminal and
alternative-choice producer/reader plus physical request binding; independent
raw external/manual/in-person receipt retention before any later canonical or
bank failure (the current payment-FK-only manual attestation is insufficient
for an unapplied receipt); complete positive/partial/credit/fee unwind; public
canonical producers/effect and genuine shared native/provider/privacy/recovery
acceptance. This finite pre-admission checkpoint does not claim those missing
behaviors or drop any already retained raw cash. Existing old5cash/24proration/
9transport and new6 histories remain in the current table-bound witnesses.
