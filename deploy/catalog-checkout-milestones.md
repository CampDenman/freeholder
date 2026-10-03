<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Catalog payment milestones

The catalog module defaults to full payment. A business can configure exact
checkout stages with `settings.setModuleConfig`. This is an instance setting;
the browser never chooses the amount. Example for a CAD order with 50% due at
checkout and 50% due before delivery:

```json
{
  "module": "catalog",
  "config": {
    "checkoutPayment": {
      "mode": "milestones",
      "currency": "CAD",
      "firstPayment": { "type": "percent", "sharePpm": 500000 },
      "milestones": [
        { "label": "Down payment at checkout", "sharePpm": 500000 },
        { "label": "Remaining balance before delivery", "sharePpm": 500000 }
      ]
    },
    "checkoutTerms": {
      "version": "owner-approved-v1",
      "title": "Purchase agreement",
      "body": "Replace with the approved full purchase agreement.",
      "href": "/terms"
    }
  }
}
```

Publish the approved terms at the linked page before enabling checkout. Change
the version whenever the terms body changes. Checkout compares both the
rendered version and SHA-256 body hash, so an edit under the same version also
invalidates an open form. It saves the actual body, hash, version, and
acceptance time on the order. Existing orders retain their own snapshot.

The invoice records the complete binding price. Percentage stages are computed
from its final integer-minor total after tax, discounts, and shipping. Earlier
stages round down; the last stage receives the exact remainder. The first
stage is payable immediately. After that payment settles, the owner calls
`catalog.releaseOrderPaymentMilestone` with `{ "orderId": "...", "position": 1 }`
at the contractually agreed milestone. Only then can the customer open the
next provider checkout. Further stages use increasing positions. The release
service refuses out-of-order releases, unsettled prior payments, and active
attempts. It does not invent due dates or collect later payments automatically.

Provider callbacks settle on the original full-price invoice. The order moves
to `partially_paid` after the first payment and to `paid` only when the full
invoice settles. Digital fulfillment and shipping remain blocked while the
order is partially paid. Cancellation refuses received money and active
payment attempts; refunds use the normal invoice refund path.
