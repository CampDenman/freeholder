---
"freeholder": patch
---

Naming a contact on cart and checkout services now requires real authority. Previously an anonymous caller who knew a contact's UUID could merge lines into that contact's open cart, read the cart back, and create orders and invoices against them through the public API. Staff with catalog access, system composition and catalog-scoped agent keys keep working; anonymous callers are refused, and the future storefront identify/checkout flows verify the shopper before elevating.
