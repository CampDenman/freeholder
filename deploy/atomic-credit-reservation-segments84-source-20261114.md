<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# B reservation segment inventory, source only

C12.38/C9.33/C1.08. This is an inventory for review before implementation.
The finite field/FK/function/trigger/source/privacy contract is
`atomic-credit-reservation-segments84.inventory.json`. No additional schema,
SQL or runtime capability is implemented or qualified here.

Existing `invoice_credit_applications.reservation_id` is the PRIMARY KEY and
RESTRICT FK to the actual reservation. An application can therefore inherit one
exact reservation-purpose receipt without another application model. Existing
reservation rows carry only assigned fee scalars and an opaque evidence digest;
neither proves an original economic interval. Their timestamps and UUIDs cannot
reconstruct that interval.

For actual4199/originalFi400/accepted retired1/actual current399, the original
first21 cumulative fee is2. Using399/4199 would return1. The proposed immutable
child records the original root interval and original assigned/proven caps;
children take differences of that original cumulative function. It carries all
nominal400/retired1/assigned399/proven/owed units separately. Current bank proof
is independent and fresh; an economic receipt never supplies current money
authority. No idempotency-key encoding, parent column or historical backfill.

Funding and reservation parent insertion remains first, followed by the exact
actual full-PG fingerprint and HMAC child in that same transaction. Parent
BEFORE validates the independently current candidate; a separate mandatory
deferred birth guard checks the genuine child and entire final graph, including
numeric coincidences and caught JavaScript errors. Old non-B rules and hash
domains remain exact. Released unused intervals remain full historical evidence;
applied intervals stay consumed. Future C compensation must bind these exact
intervals and cannot turn them into generic available credit.

The additional model, three function headers, two triggers and finite existing
B successors are proposed, not implemented. No compiler, lint, parser, model
imports, test, PostgreSQL, provider, host or installation command ran. No
readiness, closure, stable or release claim follows from this inventory.
