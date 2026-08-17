---
"freeholder": minor
---

Paid orders can now leave in split shipments. Stock writes a sale when a
carton ships, digital lines grant a download token on payment, and a return
restocks the ledger then refunds the original invoice. `/admin/fulfillment`
and `/admin/returns` are the owner workspaces. Live carrier labels still
wait on an adapter.
