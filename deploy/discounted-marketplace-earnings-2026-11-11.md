<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original discounted marketplace earnings evidence

This records a C12.09/C12.38 repair. `MASTER.md` §43 remains the only status
authority; this repair does not enable seller-merchant collection or close its
remaining integration, provider-account acceptance or independent review.

The actual supported service journey listed a CAD40.00 digital product,
applied a 50% coupon, issued its CAD20.00 invoice and recorded a synthetic manual
payment. The old ledger promised gross4000, commission400 and seller net3600
minor units. New held and instant orders instead record gross 2000,
commission 200 and net 1800 minor units. Original
invoice lines are bound before issue freezes commission; payout recording
reads those exact discounted lines. An older unbound line is accepted only
when its original variant, quantity and unit amount identify it unambiguously.

The first two native cases passed for held and instant orders. The subsequent
exact three-case retry passed: an older frozen commission400 remains400 while
new gross revenue is 2000; repeated delivery does not create or reprice another
earning; two sellers retain their invoice's cent allocation; an unestablished
fee allocation refuses earnings while the actual invoice payment stays paid.
The first larger run also exposed two incorrect test assumptions (the fee
setting's 5000bps maximum and the final-line discount remainder) and one
TRUNCATE 57014 before the test body. Those results were classified and the
affected three cases retried, without changing durability or fixture timeouts.

A separate genuine prior-image probe updated the service-created unpaid row
to the demonstrated old 4000/400/3600 amounts. The old dispatch actually sent
3600 to the synthetic Stripe adapter, created one provider attempt and marked
the row paid against the 2000 paid invoice. This is a source defect, not a
live-provider transaction. The first probe setup had attempted a duplicate
INSERT after payment settlement already created the earning; that 23505 is a
fixture error and supplies no product evidence.

Dispatch admission now compares a marketplace payout with its original bound
invoice revenue before creating or retrying a transfer. Invalid amounts stop
for review without rewriting gross, commission, net, payment, provider account,
reference or attempt identity. Never-sent and refused attempts stop; unknown
attempts remain unknown and require the existing human provider check. A
confirmed transfer still records the actual payment. Releasing or marking an
invalid payout still owed cannot reauthorize it; recording a payment that a
person actually made remains possible with its reference. No automatic
repricing or correction of recorded financial history is introduced.

Native qualification of the five histories (new, pending unsent, refused,
unknown, confirmed) passed in the finite 58.21-second composition. Its sixth
case was an intentional new before probe: a fully discounted CAD0.00 invoice
actually submitted a zero-amount provider transfer. The retained synthetic DB
record showed gross/fee/net 0/0/0 and a settled transfer amount 0. New zero-net
earnings now finalize locally, and the exact after control passed in 11.14
seconds with no provider call or transfer row. Already queued zero amounts
cannot be submitted again; unknown original outcomes still need a provider
check. Three additional old zero-queue controls are included for CI and have
not been claimed as native passes.

The eleven distinct original native controls passed across the documented
two-, three-, five- and one-case compositions, not one combined final run.
Full TypeScript, lint, licensing, release notes, plan and playground policy
passed. The explicit no-database fast gates passed 42 static contract files:
380 controls and one explicit exclusion. The F-matrix passed 369 rows × 12
criteria. After rebasing onto protected main mail72 (`dba1b242`), TypeScript
and the ten internal-service projection/composition controls passed again.
Required live-registry SDK generation passed eight controls in 3.51 seconds
against the owned disposable mail72 database and produced no artifact diff.
The original native business compositions preceded that rebase; protected
CI remains required for the final complete composition. These are bounded
local source checks, not platform launch acceptance, independent security
review or a stable-release sign-off.
