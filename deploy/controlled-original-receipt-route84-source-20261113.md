<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Controlled original receipt into the shared payment writer

C12.38/C9.33/C1.08. SOURCE ONLY. All three prepared controls are UNRUN.
No compiler, lint, build, test, database, provider or hosting operation ran.
This does not qualify payment, paid access, security review or stable.

The isolated branch normally carries frozen `783073618daf303f1e50d963c18678db1a35d814`
over `b18815fe6cb07514a6a532fe520900033ae1b89b` as `b40e2f17`.
The merge preserves the newer provider fixture getters and newer literal
internal-service inventory; root's qualified inventories remain authoritative.
No parent central financial/privacy/export files were edited by this leaf.

The genuine shared `createPayment` path reserves the route BEFORE PostgreSQL
generates the payment UUID. The new ordinary
`src/modules/subscriptions/controlled-provider-payment-route.ts` therefore
reads the actual admitted batch/receipt stage without a payment ID. Only the
real subsequent INSERT and existing SQL birth trigger create/link that UUID.
No planned payment or fake legacy phase/generation is introduced.

The transaction-local key is `freeholder.controlled_cash_application_batch_v1`.
`controlledCashBatchPointer` accepts exactly
`{batchId,collectionId,receiptId,admissionDigest}`; the digest is the actual
signed batch header digest. The old scalar marker grants no new route.
The pointer alone grants nothing: the reader calls the genuine
`readControlledCashApplicationStage` with a real shared context, verifies its
HMAC header/receipts, same transaction, current full PG parent, bank/latest
lineage, original operation/call/fact and exact next settled prefix. It requires
the already-held contact/resource/parent/canonical/cash prefix and acquires no
resource in reverse. The selected receipt still has no canonical payment link.

`registerSubscriptionInvoiceRouting` branches only when the actual canonical
receipt has an actual `subscription_controlled_charge_origins` child. It then
returns the receipt's original account/subscription/invoice/PI/charge references
and exact admitted amount/currency/fee/prior cash/allocated fee plan. All legacy
period lookup, original phase proof and default behavior stay in place.
`reserveOriginalSubscriptionCashApplication`, `assertNoUnappliedMerchantCharge`,
`commercialInvoiceCashHistory` and `invoiceCashFeeAllocation` remain unchanged.
Their actual result must match the signed receipt plan; a final genuine stage
read rechecks it before the shared INSERT. Partial receipts do not manufacture
the target's unpaid remainder or fee collection.

The NEW OWNED UNAPPLIED
`deploy/subscription-controlled-payment-route84.fragment.sql` follows:

- `controlled-cash-application-stages84.fragment.sql`, SHA256
  `06d4cdc17c1e5b93119318a6e7f4de4089aa096827b813aaf3ea4a9a276eebfd`
  (plus Commerce's separate scalar-CASE syntax successor).
- `subscription-controlled-period-source-null84.fragment.sql`, SHA256
  `0b1585e8a2051db04a7825f94d67a8be8ad97bb1a390e55468d6ffd5be3d7703`.

This tail is SHA256
`0b9f46f9eb92fed48d7719b4426795a2dae6d3339e19267c5c719ebc555671ce`,
14917 bytes. It changes no frozen SQL or journal identity, model, column or
index. Root owns assembly and actual parser/schema qualification. New inventory:

- `freeholder_controlled_subscription_route_valid(jsonb)`: verifies the real
  same-TX header/receipt/link/payment, original resource/op/call/fact, every
  proposed original route field and genuine post-birth current bank/parent stage.
- `guard_subscription_controlled_agreement_route()`, attached by enabled BEFORE
  INSERT/UPDATE `subscription_controlled_agreement_route_guard`. Any actual
  controlled origin or linked payment must satisfy that predicate.
- `freeholder_controlled_subscription_route_ready()`: checks the exact installed
  predicate/full route guard/new trigger-function body SHAs and actual enabled
  BEFORE trigger identities/types. It is the writer's route capability check
  BEFORE any new batch admission is inserted, never application authority.
- Full `guard_merchant_agreement_payment_route()` replacement: every old body
  byte is retained except `NEW.origin_kind<>'attempt'` becomes
  `(NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW)))`.
  All original scope, caller, recipient, cash, fee and immutable-history checks
  still run; the existing `merchant_agreement_payment_route_guard` stays bound.

The old route body SHA256 is
`1c1b216ad90a711ac92c4f671caae62e7231c74dad76642d7b4ac4e7c91a0c1f`.
Prepared source conservation checks reverse only the stated expression and
require exact whole-function byte equality. Prepared real SQL controls verify
that disabling the actual new trigger makes readiness false (rollback restores
it), and old/unknown pointers create no payment. These are boundary controls,
not native money or bank acceptance.

No new durable fields need privacy, search, export, merge or retention entries.
The pointer is transaction-only; the actual three protocol and six collection
families retain their independent full-row witness/private/noTTL contracts.
No new service or public/session authority field is registered.

Required next work remains real initial parent admission/writer consumption,
complete alternate-writer guards, whole-batch/partial rollback and race native
acceptance, separate genuine paid-period/proration effects, cashless and terminal
disposition/recovery, and provider/security/platform acceptance. Money-only batch
application must commit before the paid effect's separate shared transaction;
this leaf performs no access/terms/calendar mutation. There are no new deferrals
or feature/C-item/stable completion claims.
