---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C3.13: Shopify channel sync now reconciles refunds. Refunded and partially-refunded orders return their refunds; each provider refund is recorded once and, once the imported invoice has been issued, becomes an issued credit note through the invoicing module, bounded by the invoice total like any other credit note. Multiple refunds on one order produce separate notes. A refund whose order has not imported yet, or whose invoice is still a reviewable draft, stays listed as pending and reconciles on a later sync. Re-syncing never double-creates refund documents. The marketplace screen lists refund states in English, French and Spanish. Live merchant acceptance remains open.
