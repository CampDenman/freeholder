<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Accepted proration buyer export source checkpoint

C1.08/C12.38, 2026-11-13. Source only, based on ea23712d. No test,
compiler, lint, build, parser, native service or database command ran here.

The subscriptions.agreements subject export now calls an ordinary explicit
buyer projection. It retains actual accepted IDs, public commercial price and
calendar promises, buyer tax destination and notice, NET/tax/credit amounts,
status/times, and the actual debit invoice's cash/credited/refunded totals. The
invoice is joined through the real debit_invoice_id FK; an equal-value foreign
invoice or missing referenced invoice is refused. An actually null accepted
invoice FK stays null and creates no fictional cash.
Existing actual principal/credit/card/boundary children and the combined5000
archive bound remain in the shared privacy source. Actual joined invoice rows
are included in that aggregate budget.

Snapshot, destination and notice JSON are projected field by field. Merchant
fees, arbitrary review/provider/account/method/actor/hosting/queue objects and
unknown nested keys cannot become archive fields through raw row/JSON spreads.
Internal accepted snapshots and full PostgreSQL row-SHA financial witnesses are
unchanged. Four prepared pure controls retain all buyer values, inject nested
private canaries, prove original objects unchanged, cover trial/null and real
lifecycle dates, and refuse a foreign invoice. All four are UNRUN.

Classification: the declared SubscriptionCommercialSnapshot contains public
commercial terms; it does not declare feeReview/siteFee fields. The current
writer consumes that typed commercial snapshot. This checkpoint does not claim
observed disclosure or prove a current legitimate writer persisted those extra
keys; it replaces raw retained-JSON export with explicit minimization. Native
shared subject-export acceptance and final privacy qualification remain required.
No six-family controlled target model, SQL or admission change is included.
