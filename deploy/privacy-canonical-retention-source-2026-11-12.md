<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Canonical original retention membership (C1.08/C3.47/C11.14)

An actual protected-main upload control reproduced a legal reader hold being
recorded before verification, followed by rollback and shared cleanup deleting
the original WXR bytes. The old nonce snapshot was created only at fulfillment.
The separate core capture callback supplies the correct atomic boundary.

This unpublished80 source adds normalized capture receipts and immutable
original source/generation members. A completed zero-member receipt is distinct
from a missing historical capture. Members are historical opaque identities,
not mutable ownership or disclosure references. The actual hold remains their
contact-spine parent. A receipt's member count is checked at commit; neither
later expansion nor loss of a checkpoint projection can silently change its
canonical scope. Source checkpoints remain compatibility projections only.

The source helper requires the actual parent service context, registered
direct/inherited source scope and first-insert flag. It records all bounded
original members with the completion receipt in that transaction. Updates
cannot backfill an unknown historical scope. Unknown or inconsistent active
hold receipts stop cleanup for review; request cancellation is not release.
Real removal or expiry controls the live hold independently.

Shared pending-object ownership callbacks now accept an optional actual Tx.
DELETE and unused-reservation retirement recheck ownership after acquiring
the existing identity/object admission locks. The source adapter must use
that transaction. A database admission fence protects original import nonce
members even from an older cleanup worker or a lost checkpoint projection.
New raw-source holds cannot succeed without their completion receipt.

`deploy/privacy-retention-snapshots80.fragment.sql` belongs to the unpublished80
assembly. No historical receipts are backfilled. No v7 database or frozen SQL
is altered: a new v8 normal-migration diagnostic is required. The legacy
domain callback, native unchanged BEFORE/AFTER and empty/update/release,
checkpoint-loss, unknown-history and admitted-DELETE controls must qualify
the composed source. Source compilation, SQL application and all native checks
for this increment are pending. No provider, stable or full lifecycle closure
is supplied by this draft.
