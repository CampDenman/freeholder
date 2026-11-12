<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original fee refund after an unreadable success

C5.19/C12.38 remain open and the new merchant model remains disabled.

The isolated unchanged-product BEFORE at7d78484f (current17d product, ordinary
normal-v9 SQL95822693) failed6.468s. Actual shared checkout, payment, return and
credit services created a5400CAD-cent payment and its original1200 customer
refund. The returned line freezes100 of the original500 commission; the
canonical SQL retained target is400.

The real Stripe adapter factory inspected and dispatched through intercepted
HTTP. Caller A paused before its first fee POST took effect. Caller B took a
real earlier fee snapshot showing zero returned, then its response paused. A's
100 refund was accepted before a completed HTTP200 body was deliberately made
unreadable. A finished, then B's earlier response resumed. Both promises drained
before the assertion. The synthetic provider accepted two100 resources with
distinct physical keys, within the original500 fee's actual capacity. This
matches Stripe's documented permission for several partial fee refunds up to
the remaining fee; the malformed200 is a transport-fault injection, not a claim
that Stripe normally emits unreadable JSON.

Independent ledger readback found attempt1/key1 falsely refused with no
provider reference, then attempt2/key2 accepted100/fr_feeRace2. Only the second
100 observation had been retained. The original1200 customer refund and credit
survived, and the SQL canonical target remained400. Test-source SHA256 is
`33dbdcba25c48c6faa060954f0576d972c1aeeb0e675536c4d9971d30997f604`.
Logs: `/tmp/freeholder-fee-malformed-before80-native-v9.{json,log}` and its
`-ledger.json`/`-drain.json`; runner exited1 with no active database work.

The actual populated BEFORE was preserved separately as
`freeholder_fee_unreadable80_populated_before_v9_test_20261112`. CREATE DATABASE
TEMPLATE was the only database write. All eight original financial-table
counts and SHA256 proofs match the source; journal81 and SQL958 stay unchanged,
with the original false-refused/accepted records and keys intact. Source and
clone clients drained. The clone proof is
`/tmp/freeholder-fee-malformed80-populated-clone-v9.{json,log}` and its
`-drain.json`.

The narrow repair treats every exception after dispatch admission as unknown.
An error's retryable flag does not prove whether the original physical effect
exists. Capacity and the original key stay reserved; the existing bounded
resource recovery must identify that original operation before acceptance.
An error never supplies a new replacement-key permission. No migration,
historical money, accepted resource or old refused row is rewritten. This
source repair is not yet qualified by types, lint or unchanged native AFTER.
The later preserved-clone review must report actual returned200 as review/debt
with no additional POST or financial-history rewrite; that check remains
pending. Fee-caller, all bank/action states, human flows and actual provider
acceptance remain separate requirements.

Primary source: [Stripe application-fee refund creation](https://docs.stripe.com/api/fee_refunds/create).
