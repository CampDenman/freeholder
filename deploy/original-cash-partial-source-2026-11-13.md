<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original cumulative partial cash source checkpoint

This is a bounded SOURCE ONLY, UNQUALIFIED increment for MASTER §43 C12.38,
C5.19 and C1.08, based on frozen917760c4. It does not close a checklist item,
activate models, sign off a payment flow, or establish stable readiness.
No compiler, lint, build, install, test, database, native or provider request
ran for this increment. Prepared control bodies below are UNRUN.

## Exact original money and policy

`invoicing.reconcileOriginalPartialCashReturn` accepts the actual original
payment UUID and a literal human confirmation. It derives every money value
from original principal, completed real return allocations, issued credit
lines, actual logical refunds, their immutable request receipts and fresh
bank proof. The original saved invoice-line UUID must exist on the ordered
item: a unique same-price candidate cannot supply its identity. Generic
original invoice refunds use their own exact request/caller/resource lineage
and the existing original-payment proportional commission policy; no credit
or return allocation is attached by equal amount.

Original collection version chooses fee authority before arithmetic. Order
v1 preserves its actual accepted per-line floors, including legitimate
`floor(1 × 50%) + floor(1 × 50%) = 0`. Booking/subscription v0 preserves its
accepted aggregate floor, so the same aggregate net two yields one. Aggregate
line residuals use fractional remainder then actual original line UUID order;
standalone real shipping remains an explicit invoice component. Every actual
captured fee must match its original cumulative allocation under that policy.
Incompatible old frozen terms or observed fees stay review debt; this source
does not rewrite them, infer a new historical protocol, or reinterpret an old
accepted zero as one.

Recipient target is `floor(actual original transfer × cumulative returned
original principal / original principal)` using BigInt and the actual original
transfer currency. The last original unit retains every residual cent. Fee
target uses the exact accepted retained original line fee and the actual
original fee resource: same-currency observed excess remains in the correction;
an actual foreign fee is allocated by original accepted fee credit, without
inventing an exchange rate. Overreturned resources remain explicit debt.

Each immutable target binds source digest, original principal, returned part
and credit UUIDs, original bank inventory read, original fee/transfer parents,
recipient/account/platform/charge/currency and cumulative targets. It has its
own auxiliary generation. Stable target identity excludes a later read UUID
or a new human authorizer, so reinspection cannot mint money authority. A new
physical generation is admitted only for its exact remaining amount after all
older callers finished or received an authentic stop review, and every older
auxiliary resource has exact positive binding proof. An unreadable accepted
response is recovered by exact original ACK or metadata GET; unknown absence
does not permit a second POST. Actual callbacks commit independently before
later application or policy failures. A partial closure satisfies only the
current cumulative auxiliary obligations, retaining unreturned principal and
all other customer cash, dispute, settlement and original-scope debt.

## Shared canonical credit capacity

Lock order is original payment, original invoice, sorted actual credit-note
UUIDs, then original cash namespace. The source calls the canonical private
`invoicing.creditNoteDisposition` query under those locks. An RMA note must
report `reservedForReturns:true`, zero applied and transferable available
money, no review debt, and reservation equal to the **whole original note**.
Its exact revision and receipt fingerprints join the source digest. Cash
already returned never makes that same RMA credit transferable to another
invoice. The query is read-only and must not add locks. Its absence or a
conflicting disposition keeps the partial target in review.

The shared credit writer must preserve the sibling credit-core fence: ANY RMA
ownership refuses canonical funding/application; reverse RMA ownership refuses
any retained canonical funding/reservation/application lineage, even released
or voided history. No RMA source file in this increment adopts equal credits.
That sibling integration and its native controls remain unqualified here.

## Actual unassigned cash and original remainder

`invoicing.reviewOriginalUnassignedCash` requires a freshly verified person,
an actual retained bank-read UUID, actual server raw refund-fact UUID and
literal confirmation. It proves the exact resource/charge/PI/account/platform,
money and terminal bank state in one fresh complete inventory, with all actual
local creators quiesced. Any original request or claimed lineage refuses
relabeling. Its new signed review records `originalCreator:null`; it does not
manufacture a historical caller, payment, logical refund or request association.
Actual observation-capture and raw-feedback UUID snapshots preserve occurrence
identity without clock, TTL or process-birth absence assumptions. New contrary
state or money invalidates the review.

The common dispatch capacity can then count the approved actual resource while
keeping its request UUID null. The separate unapplied original-cash path sends
only its actual remaining customer money and retains an exact new authorization
receipt. An existing unsubmitted reservation keeps its original amount; a
changed remainder requires explicit retirement of that reservation, not key
reuse with altered money. Full cash, fee and recipient proof still precedes
the canonical unapplied-return disposition. Alternate/raw PI closure never
waives obligations on an unrelated canonical payment.

## Root integration contract: four models, five arrays

No new table is added to the four frozen original-cash models:
`original_cash_recoveries`, `original_cash_recovery_operations`,
`original_cash_recovery_facts`, `original_cash_recovery_closures`.
Facts additionally carry `partial_target`, `partial_closure`, and
`unassigned_refund_review`. Existing signed owner, operation, fact and closure
bodies verify unchanged; new optional target UUID belongs only to new requests.

The exact helper contract is:

```ts
originalCashRecoveryFinancialWitness(
  tx,
  exactPaymentIds,
  exactSubscriptionChargeReceiptIds,
): Promise<{ owners; operations; facts; closures; feedback }>
```

Root owns `merchant-refund-dependencies.ts`, `merchant-payment-dependencies.ts`
and `merchant-tax-privacy.ts`; this increment leaves all three untouched.
Root must include **all five arrays** in central financial fingerprints,
retained export, merge-undo refusal and aggregate bounds. Each feedback entry
is `{ namespace, feedback }`. The namespace is:

```ts
{
  paymentId: string | null;
  subscriptionChargeReceiptId: string | null;
  originalObservationIds: string[];
  providerPlatformAccountId: string;
  chargeAccountId: string | null;
  originalPaymentRef: string;
  providerApiVersion: string | null;
  originalResourceRefs: string[];
}
```

It derives from actual retained positive payment observations or exact original
subscription charge receipts, never current configuration, amount, contact or
email. Actual request bindings and authenticated original bank callback facts
supply resource references. Raw feedback is selected by exact original PI OR
those actual resource refs, retaining a contradictory PI instead of losing it.
Legacy feedback HMAC, raw evidence digest, occurrence UUID, intake bytes digest
and retained timestamp remain unchanged. This fifth array exists **before the
first original cash owner or GET**, so a raw authenticated unassigned refund
already prevents financial undo even without new local recovery rows.

All five arrays count toward the helper's aggregate 5000 bound. Authentication
or complete-bound failure refuses undo/export; a truncated sample cannot supply
authority. The optional fourth helper argument is internal read exclusion for
current cash-revision construction only. Central callers use the three-argument
form and retain every occurrence. Intrinsic cash revision excludes its own
authorization/partial-closure/review facts to avoid self-invalidation; central
financial fingerprints must include them. Existing transactional privacy repair
pointers cover the new fact kinds; primary financial writes still commit first.
Existing no-search/no-automatic-retention rules for the four models remain.

## Shared surfaces and prepared evidence

Two new public money operations share service permission, fresh human
verification and audit authority over UI/HTTP/MCP. Keys and agents cannot supply
human approval or caller money/status. Five new private phases appear in both
internal service inventories. Owner recovery shows exact original returned
principal separately from a full-cash closure, original unfinished caller
recovery, and actual unassigned resource ID/money for explicit review. Existing
customer RMA quantities, issued credits and refund status remain on their shared
services; partial auxiliary reconciliation neither issues another credit nor
changes their confirmed customer refund. Eight meaningful strings in each of
English, Spanish, French and Arabic cover the new recovery controls.

Prepared UNRUN controls comprise **13 pure, two actual-factory adapter, nine
service-contract and three native cases**. Pure cases cover v1 zero/v0 aggregate
cent boundaries, deterministic real-line residuals, BigInt safety, cumulative
recipient/foreign-fee residuals, observed fee excess, overreturn and exact
unassigned-resource capacity without request adoption. Adapter controls accept
an unreadable second equal generation and GET-recover only its exact metadata.
Native bodies prepare three actual returned original units with unchanged
credit/part/line rows, whole RMA-credit reserve, repeated reconciliation without
another POST, a genuinely unreadable second recipient generation, and signed
unassigned feedback before an owner/GET followed by explicit review and actual
unapplied remainder disposition. Only provider edges are synthetic. Existing
frozen native fixture bodies and prior failures are unchanged.

The owned UNAPPLIED tail is `deploy/original-cash-partial81.fragment.sql`, SHA-256
`b1cadc24ef55c967a845de73884528ca52966bd49417b1f8ad780554168e403c`.
It follows unchanged ab894, extends fact/target-generation guards and replaces
the raw-feedback intake guard with the same canonical payment locks plus exact
original cash namespace locks. One ordinary migration transaction must hold
ACCESS EXCLUSIVE locks across the active-caller preflight and new ABI. Actual
unfinished callers refuse upgrade. The previous image lacks the v2 setting and
must fail closed after upgrade; rollback requires the pre-upgrade database.
This tail is unassembled and unapplied. Earlier fragments remain:

- Full cash: `ab894bec2daba2b060012f5c59c9108f8acd8e6e4450b7525771a7f0ae301a74`.
- RMA: `5c2a285cc619a2fcd7a4314e98ac62a08f7a842e1740a245cfaf6e5ed1d07a11`.
- Legacy recovery: `d4ae54e3b8b9f93b28b98a6e5f42d9f98835353f221f3290afbd8613a9f9a3f0`.
- Current proof: `73a89f9dcc9b79bca72b713f53db81949c27cdd805f0fc05714cae6ea2203678`.

Combined source gates, SQL assembly/parity, new databases and independent
ledgers, simultaneous target/late-callback/corruption/host-stop natives,
receipt-only subscription NULL-payment acceptance, populated upgrades and
rollback, source-bound financial merge/export controls, SDK/browser/customer
journeys, actual provider acceptance and independent review remain required.
Prepared cases supply no actual qualification. No feature is permanently
deferred and no stable sign-off is supplied.
