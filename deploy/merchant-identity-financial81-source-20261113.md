<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Merchant identity financial snapshots — 2026-11-13

C1.08/C12.38; MASTER §43/§44 remain the product/status authority. Finite
SOURCE ONLY continuation on frozen `c18317ea`. Only the members merchant
identity reader changes; root's three central readers, subscription
merchant-scope, all24 witness helpers, five cash arrays, schemas, SQL, original
signature/caller bodies and preserved database evidence remain unchanged.
No compiler, lint, tests, database, native, build, install or provider ran.

The existing `invoice_merchant_collections` registered undo callback now reads
the actual immutable collection `taxPolicy.profileId`. It requests the exact
profile-mode24 financial witness before looking at routed payments, even
when the original profile has no contact pointer and no payment was created.
That profile is only a candidate filter, never a seller ownership claim.
Each collection seeds its own actual invoice/source-invoice/target-invoice
FKs, then closes only actual proration, principal, note, funding, reservation,
application, original remittance and read parent links. Profile/subscription
membership alone creates no graph edge. Unrelated same-profile histories
remain outside that collection's hash. It never searches profiles by current
contact/account, treats amount equality as ownership, or broadens a mixed
invoice to all its sellers. Original
collection/allocation merchant-contact selection and the frozen routed
payment filter remain unchanged. Profile history is a conservative financial
dependency; it grants no export, payment, erasure or settlement authority.

Actual original allocation/collection pairs prove whether invoice+profile
identifies one collection. If multiple sellers share a platform-liability
profile on one invoice, unassigned cashless children cannot be allocated by
tax ownership: that affected snapshot is non-undoable/review. Actual payment
FKs through the original allocation and collection distinguish this seller's
payments from sibling payments; proved foreign siblings are excluded. Missing
or contradictory ownership refuses, rather than hashing all sellers as one.
Cross-invoice credit ancestry retains its original funding/note/line and
actual principal. A source allocation route must retain the same frozen
seller UUID/profile and consistent original payment/invoice/collection FKs.
A source without an allocation route needs its real payment→invoice→original
subscription-policy FK and the same frozen policy seller UUID; a mismatched
subscription source, other seller, missing source or unsupported unprovable
manual source remains review debt. No current profile/account or amount fills
that gap. A uniquely owned original collection invoice remains a valid source
through its actual invoice FK.

The existing `subscription_market_policies` reference now reads the exact
subscription-mode24 witness using the actual policy's subscription UUID.
It covers accepted cashless/trial promises and their real source/target
credit, principal, fee, boundary and card ancestry before any invoice or cash
exists. Existing merchant-contact selection and repoint/restore operations
remain unchanged. Ancestors that genuinely cross subscriptions stay tied to
each original root through the ordinary adapter; equal invoice totals or
another seller on that invoice cannot manufacture ancestry.

Each distinct frozen profile/subscription candidate root is read once per callback.
Each physical table+actual UUID row counts once across that callback's roots;
different tables sharing an application/read UUID remain distinct. A repeated
row with changed full SHA or parent material refuses a partial witness.
Missing/invalid frozen UUIDs, incomplete original ancestry, foreign profiles,
over5000 parent-plus-distinct-selected-child rows or a failed existing dependency read
make the existing merge capture non-undoable. A later history change makes
the existing restore callback conflict before it restores contact pointers.

Nonempty financial history is folded into the existing pointer material as
table-bound full-row SHA entries with actual parent UUIDs. No private row
body or safe export projection replaces the full internal SHA. If actual
history is empty, its key is omitted: the original raw policy material and
collection material/payment-dependency object remain byte-for-byte unchanged.
Parsed receipts remain the same UUID-only `id/contactId/fingerprint` or
`id/fingerprint` shapes. No new evidence kind, namespace rewrite, row-ID map
deduplication or permissive receipt parser was introduced.

Collection composition passes `rows.length + distinctFinancialRows` into the
root-owned `invoiceMerchantDependencyFingerprints` optional fourth argument
`additionalWitnessCount=0`. These are actual external collection/24-family
rows. Existing route records supply the unchanged payment filter and are
already covered by that reader's owned money; they are not invented extra
cash witnesses. Original ownership/source selectors independently use5001
sentinels and refuse incomplete/ambiguous identity. Only genuinely selected
table-bound financial children enter the material/count. The root helper must
validate the count and include it in
every applicable complete aggregate budget, including early empty-filter
returns. That signature/count implementation is intentionally outside this
slice; the frozen `c183` base still has three arguments. Root must compose
its separately owned compatible fourth-argument correction before full
types/native qualification. Existing five cash families remain byte unchanged.

Eleven prepared test groups (14 expanded cases) are UNRUN. They invoke actual
registered capture/restore closures and actual adapter SQL through synthetic
read results, mocking registration sinks and the separately owned payment
dependency seam only. They cover exact old-empty hashes/receipt shapes;
profile-null-contact/no-route cashless history; four actual table hash change
classes (accepted/manual principal/manual fee/card read); actual cashless
subscription roots; unchanged frozen payment filters and distinct counts;
separate table-bound payment/read UUID identities; invalid/foreign/incomplete
refusal; unrelated same-profile exclusion; ambiguous shared-platform cashless
refusal and exact physical sibling allocation distinction; genuine credit
ancestry with actual route or original manual subscription-source proof and
foreign/mismatched source refusal; and exact5000/overflow. No synthetic
ServiceContext, financial insert, receipt backfill or provider call is used.
These prepared controls do not establish native contact merge/undo, actual
SQL, transaction/concurrency, original proof verification, retention/export,
independent sign-off or stable acceptance. Full combined qualification and
all existing gates remain open.
