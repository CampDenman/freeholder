---
"freeholder": minor
---

Carts now belong to a contact (or a guest token until one is identified),
prices and stock refresh on every read, and checkout creates a real order
plus an issued invoice. Paying the invoice, then the order, consumes held
stock. `/admin/carts` and `/admin/orders` are the owner workspaces.
Coupons, shipments and a public storefront checkout still come later.
