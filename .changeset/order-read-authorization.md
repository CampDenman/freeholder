---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C5.16/C5.17/C5.22/C11.10: Require catalog read authorization for order details. Knowing an order ID no longer grants anonymous access to its shipping address or line items. The staff order screen and API keys explicitly authorized for catalog.getOrder retain access; customer self-service order lists keep their existing contact ownership checks.

Raw stock reservations now require catalog management authority; checked cart and checkout composition remains available. Stock notification enrollment requires the signed-in contact’s own profile or authorized catalog management, preventing anonymous enrollment of another contact.
