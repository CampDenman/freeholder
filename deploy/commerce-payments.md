<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Commerce payment providers

This is the C5.06 provider checkpoint over Freeholder's one money spine. Manual,
Stripe, and PayPal never write a parallel balance: a checkout or owner-attested
offline receipt creates one `Payment`, and every refund creates one `Refund`
against the same immutable invoice.

## Choose a provider

Set `adapters.payments` in `freeholder.config.ts` to `manual`, `stripe`, or
`paypal`. A fresh instance selects `manual`; it can record cash, cheque, bank
transfer, or a card processed in a separate terminal without any credential or
network call. Offline settlement and refund services require an authorized
invoicing manager and step-up authentication where the actor has a step-up
policy.

Stripe requires:

```dotenv
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Point its Workbench webhook endpoint at:

```text
${APP_URL}/api/payments/webhooks/stripe
```

The adapter pins the known-compatible `2026-02-25.clover` API version. During
endpoint-secret rotation, put the retiring secret in
`STRIPE_WEBHOOK_SECRET_PREVIOUS`; remove it after Stripe's rotation window.
The handler accepts any valid `v1` signature, requires the exact raw body, and
rejects signed timestamps more than five minutes from receipt. Stripe's
official guidance requires raw-body verification and describes timestamped
replay protection: <https://docs.stripe.com/webhooks>. Hosted Checkout and
future-use consent follow the official Checkout contract:
<https://docs.stripe.com/api/checkout/sessions/create>.

PayPal requires:

```dotenv
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_ENVIRONMENT=sandbox # change to live only after sandbox proof
```

Point its REST-app webhook at:

```text
${APP_URL}/api/payments/webhooks/paypal
```

Freeholder posts the exact parsed event plus all PayPal transmission headers to
PayPal's `verify-webhook-signature` endpoint before touching the database. It
does not download a provider-supplied certificate and therefore adds no webhook
SSRF surface. PayPal's verification contract is documented at
<https://developer.paypal.com/docs/api/webhooks/v1/>. Orders and capture follow
Orders v2 (<https://developer.paypal.com/docs/api/orders/v2/>); saved methods
follow PayPal's provider-hosted consent/vault flow
(<https://developer.paypal.com/docs/checkout/save-payment-methods/>).

`platform.doctor` reports whether the selected provider has both its API and
authenticated-feedback settings. Doctor never creates a checkout or moves
money.

## Runtime contract

- `invoicing.listPaymentProviders` returns readiness, capabilities, methods,
  and whether a provider is selected. It never returns a secret.
- `invoicing.beginPaymentCheckout` creates the ledger attempt and provider
  session under the same idempotency key. Success and cancellation URLs must
  remain on `APP_URL`, preventing an authenticated caller from turning a
  checkout into an open redirect.
- `invoicing.completePaymentCheckout` captures an approved PayPal order or
  rechecks Stripe Checkout. The public cart/customer choreography belongs to
  C5.21; current callers are scoped API/MCP/admin clients.
- `invoicing.submitProviderRefund` reserves the amount in Freeholder first,
  submits one idempotent provider refund, then starts or settles the existing
  refund state machine.
- `invoicing.recordOfflinePayment` and `recordOfflineRefund` require a plain-
  language owner evidence note and accept an external statement/reference.
- masked saved-method listings expose brand/label/last four/expiry only. The
  provider token and provider-customer reference stay internal. Revocation
  removes the provider token before marking the local evidence revoked.
- disputes retain amount, currency, provider occurrence time, reason, evidence
  deadline, and open/won/lost state. Older provider events cannot move a dispute
  backward.
- `invoicing.reconcilePaymentProviders` reports unsettled attempts, open
  disputes, and authenticated event receipts. Provider fees, balance
  transactions, and payout deposits remain C5.08 work.

Hosted provider calls occur inside an idempotent service transaction. No local
random identifier is sent in the provider request, so a provider effect that
outlives a database rollback can be retrieved by retrying the identical key and
identical body. The eventual webhook is still authoritative for asynchronous
settlement.

## Webhook threat and failure behavior

The HTTP boundary caps announced and actual bodies at 1 MiB, lower-cases header
names, retains exact bytes for verification, and stores only a SHA-256 digest
plus the normalized event receipt. Raw bodies, payer payloads, signatures, and
credentials are never persisted.

Receipts are unique on `(provider, provider_event_id)`. A duplicate returns
success without applying money twice. Different events for the same payment,
method, or dispute are serialized by transaction locks and provider occurrence
time. Authenticated amount or currency disagreement refuses settlement. An
event that arrives before its idempotent checkout transaction commits receives
`503` plus `Retry-After`, so Stripe or PayPal retries it instead of Freeholder
silently acknowledging unmatched money.

Stripe intentionally does not make `payment_intent.payment_failed` terminal:
Checkout can reuse that PaymentIntent after a customer corrects a declined
method. Terminal async session failure/expiry owns failure. PayPal capture
decline/denial is terminal. Provider success can never overpay an invoice; the
existing invoice advisory lock refuses a competing settlement.

## Sandbox acceptance

Before live credentials:

1. Apply migration `0046_right_swordsman.sql` and run `platform.doctor`.
2. Create and issue a small invoice through the generated invoicing API.
3. Create a sandbox checkout with a unique idempotency key. Retry the same
   request and confirm the payment/session IDs do not change.
4. Complete one immediate and one delayed/failed test payment; resend the same
   webhook and confirm one receipt and one balance movement.
5. Submit a partial refund, resend its webhook, and confirm the refund and
   invoice remain balanced.
6. Exercise a sandbox dispute and a saved-method add/remove event. Confirm only
   masked method data appears through the list service.
7. Send a forged signature, stale Stripe timestamp, oversized body, mismatched
   amount/currency, and an event before its payment exists. Expect refusal and
   no ledger mutation.

The repository tests use deterministic mocked provider HTTP only. They never
make a real, billable, sandbox, or live provider request.

## Rollback

The migration is additive except for widening the existing
`money_state_events_subject_valid` check to admit disputes. The previous image
continues to read invoices, payments, and refunds; it ignores the four new
tables and nullable checkout reference. Roll back the image normally. Do not
drop provider evidence during an incident. Disable hosted checkout by selecting
`manual`, retain the webhook endpoints until outstanding attempts settle, and
reconcile before removing credentials.
