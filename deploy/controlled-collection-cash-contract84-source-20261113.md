<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

C12.38/C9.33/C1.08 typed SOURCE ONLY contract checkpoint. All controls UNRUN.
`controlled-provider-collection-cash-contract.ts` exports concrete strict
controlledCollectionCashProof / ControlledCollectionCashProof and constituent
controlledCashPhysicalEntry, controlledCashBankExpectation,
controlledCashFeeAllocation, controlledCashReceiptProof / ControlledCashReceiptProof
and controlledCashCanonicalProof. This is a DTO, NOT an authority or registered
service. The old dirty paid-only cash prototype remains UNFROZEN and must not be
consumed. The real batch reader remains required source implementation.

The ordinary producer will export readControlledCollectionCashAuthority(realCtx,
{collectionId,receiptIds:explicitUniqueSortedUUIDs}) from
controlled-provider-collection-cash.ts, re-exporting the contract. A singleton
wrapper may pass exactly one UUID. No Tx-to-ServiceContext fabrication is allowed.

Actual bankInvoice includes complete paid/remaining/total/current invoice/payment
inventory, actual manifest operation/call/resultDigest and zero-wallet proof.
An honest partial paid amount with status open and a nonzero unpaid remainder is
representable, without upgrading canonical.paidMinor or access. Each receipt has
actual origin operation/call/fact, all original observation IDs, latest genuine
returned inspection/state/finish caller, immutableBankRevision separately from
current namespaceRevision, actual bank/payment evidence, exact original expected
route/fee, full PG witness entries and existing canonical payment UUID only where
an actual immutable route proves it. Physical IDs may be composite; their explicit
hashDomain is postgres_row, not canonical dependency or schedule hash.

canonical contains actual outstanding/total/credited/paid/refunded/currentCollectible,
originalCreditNoteId and exact funding/reservation/application IDs, feeDutyId and
feeCreditAssignmentIds with separate creditRevision/feeRevision/revision. These
are real reads, never fake principal projections. feeAllocation identifies actual
canonical prior cash/allocated fee separately from the exact earlier requested
receipt plan; planned fee is neither recorded cash nor actual remittance. Later
staging must prove actual canonical deltas before the next entry, not reuse a
cached scalar grant over changed money. Existing routes keep original fee epochs.

prospectiveRawBindings names exact fact/operation/call/actualDigest and actual
receipt IDs. This is a positive occurrence association, NOT permission to ignore
an entire mixed invoice/list fact. Parent must prove each monetary atom already
canonical or exactly prospective; all other occurrences and rawReviewFactIds stay
visible. unfinishedControlledCallIds, unfinishedInspectionIds and
unfinishedNamespaceCallers(kind refund|recovery,id) remain explicit. Full CURRENT
parent/batch/privacy/debt/caller safety is a separate genuine parent authority;
its exact prewrite proof retains ALL rows and normalizes only authenticated actual
canonical deltas. No historical full-parent digest is used to rank bank reads.

All four supplies*Authority flags are false. Requests and receipts use the existing
aggregate5000 bound, not a new arbitrary batch-policy cap. Matching UUIDs, totals
and a valid DTO alone never confer money authority. Ten prepared contract controls
cover partial balance/status, over/under capture, exact IDs/currency/hash domains,
unfinished/raw retention and refused authority flags. Full bank-reader/HMAC/
lineage/namespace/raw inventory implementation, real parent prospective context,
SQL staging/routing, canonical application and native race/rollback qualification
remain REQUIRED. No capability/stable/provider acceptance is closed or deferred.
