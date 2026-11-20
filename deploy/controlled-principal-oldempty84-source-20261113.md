<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Controlled principal integration review and bounded old-empty successor

C12.38/C1.08. SOURCE ONLY. Nine selector cases and two independent source
contract controls are PREPARED/UNRUN. Both genuine dbd principal natives remain
UNRUN. No CPU, compiler, lint, test, build, PG, provider-account or root writes.
Isolated descendant of frozen dbd464c5. MASTER §43 remains status authority.

## Ordinary old-empty read surface

The original dbd reader unconditionally queried controlled_cash_application_links
even when the existing namespace contained zero receipts and no controlled
origin. That expanded ordinary legacy reads into future application tables.
Zero receipts alone is insufficient negative ownership evidence.

The successor reads only the existing actual canonical namespace receipts,
authenticated controlled namespace membership, and immutable original agreement
route before considering the future link table. A legacy empty result requires
ALL: zero actual receipts, zero known controlled namespaces/aliases, ordinary
non-provider_schedule method, ordinary non-reserved idempotency key, and either
no agreement route or a genuine ordinary attempt shape without receipt alias.
Duplicated ownership, schedule-without-route, missing/foreign schedule aliases,
substituted method and impossible attempt alias refuse. Any reserved
controlled-receipt: key or actual receipt/known controlled alias stays on the full
membership path. A reserved key with missing receipt/link refuses, never returns
legacy. Later FK/HMAC/source/route/current bank and complete parent checks remain.

The exact negative protocol invariant is independent of amounts/accounts: BOTH
existing signed receipt guards require payment_idempotency_key equal to
controlled-receipt:<actual collection UUID>:<actual receipt UUID>. The genuine
AFTER INSERT trigger selects that exact receipt proof by NEW.idempotency_key,
validates the actual new UUID/body, and inserts the immutable lifetime link only
at trigger depth. A historical ordinary key cannot be a GENUINE controlled
application birth. Prefix never grants ownership, payment or principal authority.
This is not a claim to detect arbitrary corrupted links fabricated after SQL
constraints/guards were disabled. A bare FK cannot detect that without reading
the future table. Every known/reserved controlled source still refuses incomplete
or contradictory real ancestry, as root requested.

## Exact staged money call chain

The dbd same-transaction principal refusal stays byte-unchanged. Source tracing:

- applyControlledReceiptBatch first calls admitControlledCashApplication. Its
  initial 0ee evaluator invokes principal/debt only for ALREADY canonical prior
  payments BEFORE this batch/header/admission or any current payment is born.
- Shared createPayment calls reserveMerchantCharge → reserveAgreementCharge.
  That uses original receipt reservation, assertNoUnappliedMerchantCharge,
  commercialInvoiceCashHistory, exact fee budget and genuine stage route proof.
  Those helpers read actual rows; none calls the generic principal reader.
- After real INSERT, captureAgreementFeeCashAssignment reads original duty,
  route and actual earlier payments plus versioned atomic stage. It does not
  call originalAgreementFeeState. captureMerchantPaymentRequest returns for
  provider_schedule, so it does not enter checkout/card protocol creation.
- recordMerchantPaymentObservation stores actual bank evidence without calling
  principal. Shared settlePayment advances the real payment/invoice, invokes
  allocateSettledPayment (actual installment rows), and queues merchant fee
  reconciliation using only routing/current refund count plus enqueueJob.
  agreementRoutingForPayment's originalProrationPaymentProtocol is a plain
  original-protocol/source read, not principal/debt authority.
- Payment/invoice events are queued. core/service.ts persists the outbox inside
  the transaction and dispatches listeners ONLY after the outer commit. Paid
  effects and fee/debt jobs therefore acquire independent transactions. Actual
  originalAgreementFeeState calls principal only when later invoked by those
  real debt/eligibility services, not by the money INSERT/settlement spine.

Thus no same-TX principal exception or staged-authority reuse is needed for the
actual current writer chain. Trying to fund another principal operation from an
uncommitted current batch remains refused. Separate batches in one outer money
transaction are not a substitute for the protocol's exact bounded receipt batch.
Any future call-chain change requires renewed tracing/qualification.

## Genuine manifest fixture dependency

Root's actual first full application failed because the last retained manifest
preceded the real pay writer. Commerce owns its TEST-only repair b5876570. This
successor carries ONLY its exact frozen helper
 tests/helpers/actual-controlled-current-manifest84.ts,
without copying root product/staged/paid test changes. The two dbd principal
natives now invoke its real private read_manifest plan → genuine SDK GET → actual
proof retention after collection and before inspection/application. Its own
assertions preserve all POST counters and canonical rows; no proof is invented,
stale guard relaxed, provider generation adopted or original oracle removed.

No SQL/model/service/permission/paid-effect change. Parent current application
failure, source/native acceptance and complete remaining financial/provider/
security/stable work remain required and take priority.
