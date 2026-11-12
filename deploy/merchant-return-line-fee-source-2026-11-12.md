<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original returned-line commission (C5.19/C12.38)

The actual isolated80 BEFORE a652ce7d reproduced a wrong commission refund in
5.354s on normal-v8 SQL1ac4652c. One original seller's invoice was5400CAD cents:
line4000net+200tax/400fee and returned line1000net+200tax/100fee. Actual shared
checkout, capture and RMA services issued the1200credit and completed the1200
customer refund. One synthetic fee-resource edge accepted112 instead of the
returned line's frozen100, because reconciliation used the gross invoice ratio.
The first attempt618 stopped at a fixture-only category-code validation before
any money; the exact underscore-literal correction is preserved separately.

The BEFORE fixture uses real business services with synthetic payment edges;
it does not establish an actual provider-account or protected-main defect.
Its source starts at the earlier isolateda67 composition. Latest protected
imports/media source must still compose and regress before final qualification.

The actual populated wrong-fee database is preserved unchanged as
`freeholder_rma_fee_budget80_populated_before_v8_test_20261112`. A real template
clone checked source had no backends, retained81 normal journal entries/SQL1ac,
and matched counts and canonical SHA256 across all eight original money/credit/
allocation tables. The accepted112 resource is never rewritten to100.
Logs: `/tmp/freeholder-rma-fee-budget80-before-native-v2-v8.{json,log}` with
`-ledger.json`/`-drain.json`, and
`/tmp/freeholder-rma-fee-budget80-populated-clone-v8.{json,log}`.

The source repair remains unqualified. A private catalog source proves the
actual return→credit→frozen payment allocation→refund IDs/generations. Invoicing
independently checks the immutable original line quantities, issued credit
lines, exact refund requests and resolved original physical money. Equal totals
are only conservation checks after those references are proven, never source
association. Missing/pending/ambiguous linkage stays review debt. The cumulative
original line commission leaves final-unit rounding remainders on that original
line. Credits draw from deterministic original charge fee capacities; a ten-cent
line credit against three- and seventeen-cent resources uses three plus seven.
Claim and lifecycle debt read the same target; an undispatched reservation is
rechecked before admission. Actual positive observations remain independent.

Existing accepted112 history must stay unchanged and require explicit review;
there is no automatic charge or negative refund. No new table, foreign key,
SQL fragment or public API is added. The original-source getter is SYSTEM only,
external false, registered by its owning catalog module. Legacy and
non-order fee paths retain their prior behavior. Full partial/manual mixing,
fee/reversal callers, banking transitions, human/browser/provider acceptance and
the remaining C12.38 specification are still required. The model stays disabled.


Rounding source review: the actual RMA `returnCredit` computes each amount as
floor(originalAmount × cumulativeUnits / originalUnits) minus the previous
cumulative floor, then passes the exact net/tax amounts to `createCreditNote`.
The credit service stores those inputs without recalculating tax. For original
tax1 across3 units, a first two-unit return is0 tax; if an earlier one-unit
return precedes the two-unit return, the latter is1, with all three totaling1.
The fee target validates the combined original returned quantity/net/tax, not a
fresh per-return tax quote. A current-service three-unit regression remains
needed before claiming this rounding boundary qualified.
