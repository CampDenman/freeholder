# Vendor-edge adapter contracts

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

C5.01 establishes the provider boundary used by commerce and the later
booking, messaging, automation, social and in-person domains. A provider
implementation may translate Freeholder's typed request into a vendor API, but
business state, authorization, consent, money, tax evidence and idempotency
remain inside Freeholder's service layer and database.

## Families

| Family | Contract | Disabled behavior |
|---|---|---|
| Payments | checkout, methods/currencies, refunds, verified normalized webhooks, capabilities | offers no methods and refuses charges, refunds and unsigned webhooks |
| Tax | one quote request and immutable explainable tax lines | refuses to reinterpret missing configuration as zero tax |
| Calendar | busy windows, event upsert/cancel and verified webhooks | refuses reads and writes |
| SMS | consent-ready outbound delivery plus verified inbound/status events | records an explicit non-delivery and refuses unverified inbound events |
| Bulk mail | provider send/verification and explicit bulk routing | refuses delivery through the existing `none` adapter |
| AI | bounded purpose, prompt, output and usage result | refuses generation |
| Social | publication/removal and verified status events | refuses publication and deletion |
| Carrier | rates, labels, voids and verified tracking events | refuses quotes and labels; manual shipping rules remain a separate built-in concern |
| Point of sale | reader/tap capability, collection, refund and verified events | exposes no capabilities and refuses collection/refund |

All registries reject duplicate IDs and cross-family registration. More than
one real payment or other provider may be registered at once; database-backed
eligibility and owner selection decide which provider handles an operation.
The provider recorded on the resulting business object remains authoritative
for reversals.

## Safety contract for implementations

- Money crosses an adapter only as integer minor units plus an ISO currency.
- Every mutation has a caller-supplied stable idempotency key.
- Webhook verification receives the exact raw body bytes. It must authenticate
  before returning normalized events and must not expose provider bodies in an
  error.
- Provider credentials belong in encrypted connected-account/configuration
  storage. They never enter an adapter request, audit log, event or returned
  result.
- A provider adapter returns provider references, not new Freeholder business
  truth. A service commits the invoice, payment, shipment or publication state
  in the same transaction as its audit and event evidence.
- `none` is a real and testable implementation. It never fabricates a provider
  reference, tax quote, payment, label, event or successful send.

## Adding a provider

Implement the family interface under `src/adapters/<family>/`, register it
once during boot/configuration, and run the shared contract suite plus
provider-specific hostile-response, retry, idempotency and webhook-signature
tests. A new payment method exposed by an existing provider is configuration,
not a new adapter family.

No provider is enabled merely because its implementation is installed. The
owner must explicitly configure credentials and eligibility before it may be
selected.
