---
"freeholder": patch
---

Webhook deliveries now come with instructions for the other end. `deploy/webhook-delivery.md` previously described only how Freeholder makes an outbound request safely — HTTPS, pinned DNS, no redirects — and said nothing about how to check that a delivery really came from your site. That left the most important half to guesswork: a receiver that signs only the body, or skips the timestamp, has no replay protection at all, because the signature keeps verifying for as long as the secret lives. The guide now gives the three headers, the JSON envelope, the exact string that is signed (`t` and the raw body joined by a dot, not the body alone), a worked verifier you can paste, and the plain statement that you choose the staleness window and must enforce it. It also explains why the scheme carries a `v1=` version, and that replaying a delivery from the ledger produces a new signed delivery with a new id rather than a byte-for-byte resend.
