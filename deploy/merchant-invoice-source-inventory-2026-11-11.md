<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Existing invoice-source ownership — collection80 integration inventory

This is source evidence and an implementation checklist. MASTER.md §43 remains
the status authority. The new seller_merchant model is still unavailable.
Historical provider accounts, invoices, agreements and settled money are not
rebound to a new collection preference.

| Existing source | Actual current entry and ownership evidence | Required new-mode treatment |
| --- | --- | --- |
| `order` | `catalog/orders.ts` creates the canonical invoice; original order-line seller snapshots and migration77 allocations identify seller/site portions. | Collection80 per-party order receipts and routes, one invoice, original ownership and per-party tax/freight. Source contracts exist; tax integration/native/full flows remain open. |
| `subscription` | `subscriptions/service.ts` bills an accepted agreement. Existing `sellerForInvoice` additionally joins the current plan product, which must not replace an accepted agreement owner. | New agreement scope/version and original provider receipt lane owned by the subscription integration. Existing version0 agreements keep their exact original direct/platform behavior. |
| `booking` | `catalog/public-booking.ts` creates the booking and its invoice in one transaction. Existing `sellerForInvoice` follows the current offering/product seller. | New booking acceptance scope must freeze actual original seller/contact/business/charge and tax destination before invoice quote, including reschedules. Implementation pending. |
| `deposit`, `balance` | `advanced-money-service.ts:createDepositAndBalance` accepts an existing order/quote/booking/subscription/manual source and records that exact relation in `schedule` and `sourceId`. | Member-owned derived invoices must inherit the proved original source business/route/tax policy; mixed original parties require explicit portion amounts. They cannot silently use today's platform or destination preference. Integration pending. Ordinary site-owned manual/quote deposits retain platform collection. |
| `late_fee` | `advanced-money-service.ts:assessLateFee` assesses an issued original invoice and retains the original invoice relation in the assessment. | A member-owned assessment needs original invoice-party/source proof and an explicit beneficiary policy; it cannot silently fall through to the platform. Integration pending. Existing site-only assessments remain platform flows. |
| `tip`, `pay_what_you_want` | `advanced-money-service.ts:createFlexiblePayment` is a scoped business operation, optionally attached to an invoice of the same customer/currency. No seller/creator beneficiary is accepted. Public CMS support blocks create a business tip intent. | Existing unattached business support remains site/platform money. A relation to a member invoice must not be mistaken for an existing creator-tip entitlement; any inherited merchant routing needs an explicit proved beneficiary rather than guessed current ownership. Final eligibility guard remains pending. |
| `unlock` | The generic issued invoice causes an entitlement grant on payment (`invoice-service.ts`). No member-seller beneficiary is resolved by the existing market resolver. | Existing business-owned unlocks remain platform money. A seller-owned order buying gated content uses its original order ownership; do not infer an author merchant from a content selector. |
| `event` | `events/service.ts:issueAdmissionInvoice` bills a site-managed admission registration/ticket. No member seller relation in the current entry. | Existing site/platform behavior. Do not invent a member beneficiary. |
| `ad_campaign` | `ads/service.ts` issues the site's advertising invoice. | Existing site/platform behavior. |
| `manual`, `quote` | Scoped invoice, recurring invoice, project time and business quote paths; the existing member resolver has no seller source relation. | Existing site/platform behavior. Free-text source IDs and caller line metadata cannot adopt a seller or connected charge account. |

Before activation, the source matrix must be enforced at shared invoice issue,
payment admission and original tax preparation, with genuine source snapshots
and negative controls for caller-spoofed relations. The pending rows above are
required work, not deferrals or newly claimed product features.
