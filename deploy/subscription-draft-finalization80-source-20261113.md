<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Supported original subscription-draft resolution source

C12.38/C1.08 source only, based on unqualified `a8281b63`. No compiler,
tests, build, installation, migration or provider I/O has run here.

Stripe's official [delete documentation](https://docs.stripe.com/api/invoices/delete)
excludes subscription invoices. Its [finalize endpoint](https://docs.stripe.com/api/invoices/finalize)
accepts `auto_advance=false`. The source uses a separate original finalization
caller before the existing distinct PI-cancel and invoice-void callers. It never
invents a subscription-invoice DELETE.

A current pending erasure/cohort/hold claim, complete original invoice/PI
inventory and exact admitted phase/price are required. The draft's actual sole
price, gross amount, currency, quantity and period must match before the
finalize POST. Current pending PIs require their own original cancellation
first. The returned invoice is independently enumerated again, preserving
actual positive cash through the existing shared retainer before later
policy/auxiliary checks. `auto_advance=false` does not prove no charge or no PI:
new PIs still need their own cancellation, positive money remains financial
recovery, and current receipt plus complete final inventory govern closure.

The existing `update` operation kind records this exact frozen finalize body;
no DDL is added and the old assembled SQL, ea555/173 suffixes and goldens remain
unchanged. Four additional actual HTTP controls and updated policy controls
are prepared and unrun. The earlier `a8281b63` twenty-four controls, full native
fault/stale/hold/business/browser qualification and actual provider acceptance
remain required. Explicit amendments, new schedule generations and future
invoice/line/tax/fee lineage are still being implemented in the same next
source branch. This finite checkpoint closes no MASTER.md §43 item and
supplies no independent review or stable signature.
