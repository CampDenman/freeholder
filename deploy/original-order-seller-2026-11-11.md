<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original order seller and shipping terms — C12.38

Checkout reads and shares locks on its original variants/products before
checking whether their sellers can be paid. It freezes the seller user ID
(including an explicit null for site merchandise) and the shipping requirement
in each original order-line snapshot before issuing the one invoice.

`catalog.orderSellers` uses those original facts for payment settlement,
fulfillment eligibility and seller earnings. A malformed existing seller
receipt refuses reconciliation; an absent historical receipt retains its
previous behavior. This change never reconstructs old ownership from a current
account, email address or product. It introduces no migration or provider call.

The unchanged business regression in `tests/modules/member-payouts.test.ts`
failed against prior image `b50282e5`: after checkout, a catalog edit changed
the recorded seller from the original purchaser's counterparty to a different
member and changed a digital order's shipping flag. On the allocation77
source rehearsal, the original-owner regression and three existing payout
journeys passed. The independent repair based on main `e4b2271f` also passed
all four payout controls on an unchanged official74 database (42.68s), live
SDK generation8/8, full type/lint/license/release/plan gates and all42 static
contract files (380 passed, one documented exclusion). Protected CI remains
required before merge; unpublished77 is not part of this repair.

The same test continues through actual shared-service payment settlement and
seller earnings, asserting the original seller and original 40.00/4.00/36.00
amounts. Manual bank references are synthetic fixtures, not live acceptance.

The existing checkout remains the human/API/MCP surface; snapshots add no new
public operation or UI text. No contact pointer or provider secret is added.
The seller UUID is retained original financial ownership, not a copied profile.
C12.38, provider acceptance, the larger mixed-seller payment integration and
the stable-release sign-offs remain open.
