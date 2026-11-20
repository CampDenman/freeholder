<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Controlled canonical collection source boundary — 2026-11-13

C9.33/C9.38/C12.38/C1.08. SOURCE ONLY / UNQUALIFIED. No compiler, lint, build,
install, tests, PG/native/migration or provider account call ran in this lane.
Seven real mocked-HTTP controls are PREPARED/UNRUN. MASTER §43 remains the sole
status authority. This finite intermediate contract/runtime checkpoint enables
no stable announcement, feature closure, acceptance or new positive capability.
Necessary implementation continues in a separate descendant after this freeze.

The baseline is root f9e923de plus the normal frozen8d carry b7d428c2,
explicit holder audit projection fdfbada6 and exact root90f scope fix ffe07811.
Root b8f95901 source fixes are consciously ported: full original JSON snapshots,
concrete record parsing, type-only UI imports, and Request/URL/string adapter
fixture handling. Preserve root's original b8 documentation when merging.
No frozen financial suffix, 0–81 migration, golden, root assembled SQL, first
capture history or parent-owned central financial file is changed.

## Concrete provider edges

Actual customer GET and complete original-customer credit-note pagination retain
raw data first. Unknown/nonzero invoice/cash balances or issued positive old
notes remain review even when aggregate balance is zero. No amount selects a
source and no bank credit note or generic wallet is created.

Native create_prorations preview binds its exact date. A separate actual
no-proration update preview omits proration_date as Stripe requires. Accepted
trial end stays preserved; no bootstrap fake free period becomes paid principal.
Positive calendar update requests no automatic proration and keeps draft pause,
retaining original bootstrap metadata and new exact update-operation/request
lineage independently. Requested calendar effects are never treated as an
actual returned new subscription anchor: an independent new GET must match the
explicit accepted expected period/anchor/trial before further collection.

Concrete adapters create a manual target draft with auto_advance=false and
pending_invoice_items_behavior=exclude, or inspect an exact generated draft.
They add original product/price NET and fixed per-invoice merchant-declared tax.
This tax item is collection of the sealed canonical merchant ledger quote,
never Stripe Tax calculation or an autonomously prorated recurring tax price.
Locked canonical credit uses an attached negative amount item, with exact
canonical note/application provenance; Stripe Price creation requires
nonnegative prices. No negative Product/Price, provider wallet credit or
implicit refund is invented. Existing historical gross single-item phase DTOs,
canonical tax rounding and original fee epochs stay unchanged.

Complete actual lines must match original component receipts, amounts, periods,
products/prices and provenance. Native subscription il_ ancestry is distinct
from a genuine ii_ item; no ii_ ID is invented. The exact fee follows complete
manifest checks. Finalization keeps auto_advance=false; explicit pay uses the
original saved method. The actual pay ACK is retained separately, then complete
PI inspection commits genuine positive cash before later price/manifest/domain
failure. ACK, provider paid flag, minimum-charge wallet carry or amount_due=0
never creates canonical cash/access. Tiny residuals still need an honest real
payment route; they cannot be declared settled by a fabricated PI.

## Six immutable target families and reader ABI

The owned UNAPPLIED suffix is
`deploy/subscription-controlled-collection82.fragment.sql`, AFTER frozen
`ee87f2a0b88822119798ea5d202771675e02294e181d323489af1e6f8f296881`.
Root owns normal assembly, new journal/hash and a new qualification database.

1. `subscription_controlled_quotes`: explicit kind period|proration,
   canonicalSourceId, resource/previous terms, planned IDs, frozen target
   profile/version, four actual calendar/customer/native/update operation FKs,
   input/review and opaque digests, source/quote/effective date. Private bodies
   have explicit redactedAt semantics; active admission refuses erased bodies.
2. `subscription_controlled_collections`: real accepted canonical invoice/terms/
   proration/credit FKs, actual canonicalTargetDigest, acceptance kind, actor,
   original consent, acceptedCurrentParentRevision. No parallel money ledger.
3. `subscription_controlled_components`: original NET/fixed-tax/locked-credit,
   signed amount, currency, period and exact typed provenance/digest.
4. `subscription_controlled_invoice_bindings`: exact resource/target invoice,
   actual original creator op and independently observing operation/call/fact.
5. `subscription_controlled_item_receipts`: actual creator versus observer,
   genuine ii_/il_/price refs and source digest, distinguishing native lines.
6. `subscription_controlled_invoice_proofs`: actual independent complete
   manifest read, signed returned caller and canonical/customer-financial SHA.

Ordinary modules (never registry collectors):

- `controlled-provider-collection-witnesses.ts`:
  `controlledCollectionWitnesses(tx,{subscriptionIds?,invoiceIds?,profileId?})`
  returns six named arrays `quotes`, `collections`, `components`,
  `invoiceBindings`, `itemReceipts`, `invoiceProofs`, plus `incomplete`.
  Every entry carries full physical PostgreSQL row SHA. Quotes carry exact
  subscription/resource/previous-term/profile/version/read IDs and source/kind;
  collections carry real quote/proration/invoice/terms/credit IDs; component
  entries carry real collection/kind; bindings/items retain creator AND
  observation op/call/fact/resource; proofs retain actual collection/op/call.
  One combined5000 covers all six. Invoice selection uses exact canonical FK;
  sharing a resource never adopts its other targets. Pending/cashless period
  quotes are selected without requiring an invoice or fabricated proration.
- `controlled-provider-quote-proof.ts` authenticates each genuine returned
  original calendar/customer/native/update proof and complete unchanged quote
  digest. An unaccepted quote never reserves capacity or becomes a mandate.
- `controlled-provider-canonical-target.ts` reads the real issued canonical
  invoice, dated tax line ownership, original policy, issued credit funding,
  reservations/applications and immutable fee duty. Mutable cash/status/release
  debt is distinct from the accepted immutable commercial digest.
- `controlled-provider-collection-state.ts` validates accepted target, component
  amounts/provenance and exact genuine original creator/observer fact ancestry.
- `controlled-provider-collection-coverage.ts`:
  `controlledCollectionCoverage(tx,{subscriptionId,excludeUnadmittedOperationId?})`
  composes authenticated transport9 and target6 with ONE combined5000.
  Output has `complete:true`, `protocol:'controlled_net_gross.v1'`, `revision`,
  `inventoryCount`, `transport`, `witness`, `actualQuotes`, `actualTargets`,
  `redactedQuoteIds`. complete means COVERAGE ONLY, never current principal,
  remittance, stopped bank calendar or paid/access authority. No service call,
  mutation or parent→resource lock occurs. Exclusion rejects any own target FK
  child and can omit only the exact same genuinely empty planned operation;
  no quote, prior resource, admitted read, raw cash or physical caller is hidden.
- Export helper returns safe original IDs/parent links, never bank/customer/
  method refs, nonce, process/hosting evidence, requests, raw data or row SHA.

Quoted `economicTargetDigest` binds proposed economics before canonical objects
exist; accepted collection/SDK `canonicalTargetDigest` binds ACTUAL issued
canonical objects. These authorities must not be conflated.

## Admission and current financial ownership

The actual private service planner takes only collectionId, operation kind and
optional componentId. It derives provider payloads from actual accepted rows,
locks resource→original payments→invoice→notes, re-reads immutable source and
checks current module/agreement/deadline/partial-money state. It never accepts
an arbitrary bank account, amount or item from a public caller. Runtime dispatch
uses the concrete frozen DTOs and single actual original nonce-held caller;
actual signature/finish/stop and stale-before-claim guards remain unchanged.

Required parent ABI is deliberately a mechanical refusal until genuinely wired:

- `invoicing.controlledProviderFinancialReadiness`
  `{subscriptionId,requiredProtocol:'controlled_net_gross.v1',
  excludeUnadmittedOperationId?}` → `{ready:true,revision}`.
  Earlier strict nine-family implementation REJECTS this extended protocol.
- Separate `invoicing.controlledProviderCollectionAuthority`
  `{collectionId,kind,requiredProtocol:'controlled_net_gross.v1',
  excludeUnadmittedOperationId?}` → `{allowed:true,revision}`.
  kind is update_calendar|create_draft|add_invoice_component|read_manifest|
  set_invoice_fee|finalize_invoice|pay_invoice. This is current real money/
  refund/dispute/unapplied/principal/caller/disposition authority; ready alone
  is never substituted. Both revisions are frozen before planning and rechecked
  under the held resource/parent locks at actual physical admission. Missing
  query or incomplete/old protocol refuses; no fallback enables collection.

Parent decision: retain historical quotedParentRevision; at actual acceptance,
recompute complete current parent/coverage and exactly unchanged economics:
source IDs/epochs/profile+dated tax/currency/NET/tax/credit/cash due/fee and
commission/calendar/trial/method/namespace/API/disposition. Store the fresh
acceptedCurrentParentRevision separately. Resolved nonfinancial history may
change the full revision only when economics remain identical and all current
caller/rawcash/refund/dispute/principal/debt checks pass. Relevant changes need
fresh quote+consent. Own unaccepted quotes stay in the complete witness and
reserve nothing. Actual accepted reservation/target rows enter the physical
graph immediately; known own creation effects are explicit receipt ancestry,
never general witness subtraction or removal of an admitted read.

## Exact required remaining implementation

This intermediate boundary alone is NOT a working public positive lifecycle.
Still required in the next isolated slice:

- Genuine public/shared original period and changed-price quote/accept factories,
  actual canonical NET math validated against retained native/update periods,
  exact original saved-method consent, dated tax and locked credit/fee capture.
- Actual original generated/manual draft binding, component line receipt and
  independent proof retention commands with dedicated lost-ACK discovery.
- Final immutable canonical receipt→actual shared payment application and
  fully settled access/effect jobs; no old operation/generation rewrite.
- Genuine expanded parent coverage/current target money authority and all six
  financial/privacy/merge/search/retention inventory consumers. Source table
  definitions are exported; parent must compose all six, not truncate at nine.
- Positive financial closure and authentic late/partial target unwind/reconsent,
  including private body erasure AFTER legitimate closed financial obligations.
  Current narrow quote-body erasure only covers unaccepted reviews whose actual
  zero resource genuinely closed. Accepted positive targets cannot use it.
- Existing paid-provider migration, legitimate method/profile epochs, actual
  auxiliary lost-product recovery, original customer balance/issued-credit
  disposition, tiny residual real payment routes and all remaining full-spec
  card/manual/provider/trial/normal/interval/zero variants.
- Actual meaningful shared-service native journeys, source/SQL qualification and
  enabled provider-account acceptance. Seven HTTP controls here are prepared,
  not passes. No item is deferred or declared complete by conservative refusal.

A subscription draft cannot use one-off Invoice DELETE. Any extra-draft cleanup
needs original accepted disposition and actual no-cash/stop proof; finalization
or void cannot silently erase tax, partial cash, locked credit or a promise.
