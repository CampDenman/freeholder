---
"freeholder": patch
---

Admin pages no longer render infrastructure failures as plausible empty states. Optional reads (product variants, invoice/order customers, payment receipts, return detail, capture target lists) now treat a domain refusal as an absence and let a real failure surface, instead of `.catch(() => null)` telling the owner a product has no variants while the database is down. The marketplace seam records a new channel as `pending` rather than claiming `connected` with no provider behind it, presence heartbeats stop throwing unhandled rejections, and the one sanctioned second-transaction exception (`mail.completeOAuth`'s one-time state claim) is now documented where the rule lives.
