<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original seller return allocation (C5.19/C12.38)

The actual test-only source e689f63c uses the current shared marketplace checkout,
real two-seller invoice/payment state and ordinary RMA request/approval/receipt/
prepare services. Its synthetic payment edge supplies one successful original
charge for each merchant; no refund provider POST is made by preparation.
The target is selected from the actual later payment's immutable allocation,
so random allocation UUID ordering cannot make the control pass accidentally.

BEFORE genuinely failed at the original-payment assertion in5.943 seconds on
unchanged product f6/5a and normal-v7 SQLd060. The returned seller's1000CAD line
plus50tax belonged to original seller c2/payment1050. Preparation instead
reserved1050 against seller003's earlier4200 payment. Read-only ledger and
original returned-line IDs confirm the mismatch. Runner and connections drained.
Logs: `/tmp/freeholder-return-allocation80-before-v7.{json,log}` and
`/tmp/freeholder-return-allocation80-before-v7-{ledger,drain}.json`.
This is unreleased80 behavior, not an actual provider-account refund or a
claim that the current main single-merchant collection path sent wrong money.

The isolated repair reads selected original line/payment ownership through a
private invoicing service. New-version return amounts are grouped by their
immutable invoice allocation, and each budget uses only that allocation's own
successful original payments. A prior frozen plan must match these original
seller budgets before any further provider work. Inconsistent prior history is
refused for recovery, never rewritten. Legacy C0 and ordinary manual split
payment allocation retain the existing path. Erased business declarations do
not become current collection authority; financial refund provenance uses the
retained immutable model/route rather than the new-charge authorizer.

Full Node22 TypeScript, changed-file lint and the eight affected private/changelog
controls pass on the composed return repair plus root original-merchant merge
scope repair. Logs: `/tmp/freeholder-return-allocation80-repair-{types,lint,contracts}-v1.log`.
The unchanged AFTER case passed6.109 seconds on frozen0bd84a0f and normal-v7
SQLd060. The randomized original allocation IDs made seller003's4200 payment
second in this run; the same deterministic control returned its4000 line plus
200tax. Read-only inspection proves one4200 reservation on that exact original
payment and seller, with c2's earlier1050 payment untouched. There were zero
refund dispatches. The runner/inspection exited and database nonidle[] was
verified. The genuine BEFORE used the opposite original ordering and failed;
no source or assertion changed between the two controls.
Logs: `/tmp/freeholder-return-allocation80-after-v7.{json,log}` and
`/tmp/freeholder-return-allocation80-after-v7-{ledger,drain}.json`.

No SQL or schema changes are made. Existing ordinary split-tender, multiple-
seller return and populated inconsistent-plan controls remain separately due.
This result proves preparation ownership, not an actual provider refund. Exact
commission-by-credited-line and transfer/fee recovery remain separate required
work; a routing repair does not qualify gross-ratio commission math. Full
provider/browser/owner acceptance and C12.38 completion remain open.
