<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact original financial-reader adapter — 2026-11-13

C1.08/C9.33/C12.38. Finite SOURCE ONLY checkpoint based on signed
`9f572bc9`, following the signed foundation/gross/commission/boundary stack
through `60c78f68`. MASTER §43 remains the only product/status authority.
No compiler, lint, tests, database, migration, native, build, install or
provider operation ran. No model, SQL, current cash module or root-owned
central reader changes. This unwired internal adapter changes no public
service behavior, so it has no separate user-facing changeset.

## Contract

New ordinary `src/modules/invoicing/proration-financial-witness.ts` exports
`prorationFinancialWitness(tx, {kind, ids})`. `kind` is exactly `invoice`,
`subscription` or `merchant_profile`; roots must be actual UUIDs selected by
the already authorized parent. This helper does not authorize a caller,
mint a payment/receipt, or perform a business/provider operation.

The result is `{version:1, entries, incomplete}`. Each deterministic sorted
entry has `family`, actual `table`, real primary `id`, full PostgreSQL row
SHA256 `fingerprint`, and `parents` containing only real UUID FKs or actual
NULLs. Parent links distinguish source and target invoice/proration, original
cash payment, inherited application, note/line, funding/reservation, actual
refund/remittance and original provider/external confirmation identities.
No row body, actor, notice/destination, evidence, nonce, account, hosting or
queue payload is returned. Safe customer projections never stand in for the
internal immutable row hash.

| Family | Actual tables retained |
| --- | --- |
| `money` | `commercial_payment_attestations`, `commercial_refund_attestations`, `commercial_fee_attestations`, `invoice_credit_funding`, `invoice_credit_reservations`, `invoice_credit_applications`, `invoice_credit_releases` |
| `proration` | `subscription_prorations`, `subscription_proration_principal`, `subscription_proration_credit_uses` |
| `fee` | `agreement_fee_duties`, `agreement_fee_credit_assignments`, `agreement_fee_cash_assignments`, `agreement_fee_eligibility`, `agreement_fee_remittances` |
| `boundary` | `subscription_proration_cash_confirmations`, `subscription_proration_credit_confirmations` |

These are the same seventeen families supplied by the unchanged existing four
witness helpers. Those helpers remain available and byte unchanged. Their
whole-invoice/subscription selectors cannot isolate a party on a mixed source
invoice, so this adapter selects exact original FK/profile pairs directly;
it does not fabricate a filtered transaction or adopt foreign helper output.

## Exact source and target ownership

Invoice mode enters through actual accepted original/debit invoice FKs,
original external-payment invoice FKs, funding source invoice, actual target
application invoice, or the accepted target reservation/debit relationship.
It runs before payment/no-route exits; a cashless duty does not need a fake
payment. Subscription mode enters accepted proration rows directly, including
a genuine trial with no invoice, payment or credit. Initial attested invoices
also require their actual existing subscription and canonical source type/ID.

Merchant mode starts with exact immutable `subscription_prorations.profile_id`,
`commercial_payment_attestations.merchant_profile_id` and
`agreement_fee_duties.merchant_profile_id`. Invoice/profile pairs inherited
from those actual parents constrain further attestations; the existence of
one seller on a mixed invoice cannot select another seller's payment. A
credit target must retain its source's exact frozen profile. Cross-profile
edges refuse with `incomplete`, rather than being silently omitted or adopted.
No amount, email, current contact/account, source prefix alone or historical
process guess supplies a financial owner.

Credit closure follows actual funding/proration/note/line FKs, exact accepted
reservation source IDs, target debit/application FKs and original inherited
`source_application_id` ancestry. It selects both source and target promises,
all reservations/applications/releases of the actual funding, and the exact
root payment identities. Unapplied reservations do not disappear. An inherited
application must belong to the funding's real source invoice and retain the
same original cash payment. Cycles, missing parents, mismatched source/target
invoices, cross-profile targets and contradictory release/application history
refuse. Any RMA-owned note refuses funding ownership; its whole original
return/refund promise stays reserved.

Actual cash/refund, fee assignment and retention-confirmation invoice FKs are
checked without reclassifying amounts or proving settlement. Original
remittance returns require the actual same-family remittance and exact
invoice/payment/profile parent. The helper is a dependency witness, not a
principal-disposition or bank-authentication authority. Unknown financial
outcomes remain actual hashed history and the existing parent debt machinery
must still refuse unsafe erasure or reuse.

## Complete bounds and failure behavior

Each selection has5001 sentinel rows. All distinct table/ID entries and graph
node sets share the5000 bound; overflow returns `entries:[], incomplete:true`.
Graph discovery is finite: each changing round adds an actual FK node, with
at most5000 nodes plus one stabilization round. Missing referenced ancestors,
invalid IDs/hashes, unproved profile ownership, contradictory parent predicates
or changed hashes during repeated discovery also refuse. Duplicate reads do
not invent extra financial rows. Database/catalog errors propagate; missing
new schema is never interpreted as an empty history.

This is bounded source logic, not a concurrency or performance qualification.
Deep ancestry may require many bounded reads; fresh native fault/concurrency
and representative history-size acceptance remain required. Caller locks and
the parent's current-source/late-callback safeguards must remain. No old row,
signature, namespace, original task or first failure is repaired by inference.

## Root composition still required

Root owns `merchant-refund-dependencies.ts`,
`merchant-payment-dependencies.ts`, `merchant-tax-privacy.ts`, and subscription
undo composition. They are unchanged here. Integrate the adapter before
payment/no-route returns and fold its full exact entries into the already
parsed fingerprint, or add explicit schema-backed evidence kinds. A returned
`incomplete` must make undo non-undoable/export refuse; do not treat it as no
children. Add these distinct children to the parent's complete5000 cohort
bound, not merely a count of invoice hashes.

Use `invoice` only for the buyer's actual complete invoice ownership. Seller
callers must use `merchant_profile` with exact frozen profile IDs; an empty
seller payment filter cannot discard cashless obligations. Subscription undo
must use direct `subscription` roots so a trial's accepted proration is
witnessed even without an invoice. Do not change the existing canonical
`<subscription>:proration:<id>` invoice source selector merely to find targets.

Preserve root's five authenticated cash arrays and namespace+feedback identity
exactly, including real receipt aliases and raw feedback before owner/GET.
This adapter creates no cash namespace, fake NULL-payment alias or replacement
cash model. Existing principal/caller/read/fee/recipient debt and privacy
holds remain authoritative. Buyer exports still use explicit safe projections;
merchant-private commission export requires its own actual authority.
Carrier's later card-caller family is a separate additive checkpoint and is
not silently inferred or qualified here.

## Prepared controls — all UNRUN

Ten synthetic read-driver controls compile the actual SQL and exercise:
cashless trial and duty selection; actual boundary IDs; unapplied source/target
credit and retained release; frozen merchant selectors/foreign refusal;
missing inherited proof; a positive inherited application/root-funding graph;
contradictory parent/changed hash refusal; per-family AND combined overflow;
and malformed roots refusing before reads. Returned row bodies are synthetic
driver responses, never hand-inserted money or fabricated ServiceContexts.
They cannot prove PostgreSQL joins, real ownership, transactions, migration,
privacy, concurrency or provider behavior. All such actual qualification,
combined source checks, root integration, independent review and full current
specification completion remain open; no stable sign-off follows.

Additional source review requested by root found no private fee/actor material
in the accepted proration `snapshot`: `SubscriptionCommercialSnapshot` is a
strict public offer/price/tax-category/calendar/trial schema. Its separate
accepted `noticeSnapshot` is locale plus controlled notice text, and the
exported destination belongs to the buyer. Private fee review/account fields
are outside that snapshot. No unrelated projection change is included.
