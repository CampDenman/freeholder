<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Seller refund children in merge undo (C12.38/C1.08)

The registered `merchant_tax_profiles` contact reference now folds the
bounded original cash owners and their refund dependency fingerprints into
its existing parsed fingerprint field. No new retained witness fields are
silently discarded by the undo schema. The fifteen child tables contain no
mutable contact FK; original provider bodies, actor history and opaque
identities remain unchanged.

Allocation payments are selected through the exact original collection's
profile and quote, never every payment sharing its invoice. Booking routes
use their own original profile. Agreement routes and unapplied subscription
cash receipts use their frozen subscription merchant scope. Queries are
bounded; incomplete ownership or child inventory makes undo unavailable.
The added profile-to-subscription query requires the companion scope index
`subscription_merchant_scopes_tax_profile_idx` before database qualification.

Full Node22 source types and focused lint pass against helper checkpoint
`a11fc660`. Dependencies were reused from the qualified invoice allocation
worktree after exact manifest and lockfile comparison, without an install.
The actual mixed-invoice regression fixture is prepared but **unrun**: it
reserves another seller's refund, proves undo still succeeds, then creates
this seller's refund child and requires undo refusal while retaining both
the current owner and original immutable child. It needs the complete new
refund schema and fresh normal80 database; no native or production behavior
claim is supplied by source checks.

Existing witnesses retain their JSON shape. A legacy fingerprint that cannot
prove this additional financial history may conservatively refuse undo.
Historical merge artifacts are never rewritten to invent that evidence.
