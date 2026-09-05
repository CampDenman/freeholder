---
"freeholder": patch
---

Queue account and campaign email only after encrypting its short-lived message
body, so a slow mail provider can no longer hold open or roll back the business
transaction that asked for it. Delivery retries keep stable evidence without
putting message bodies or credentials in job data, and discard the encrypted
copy after submission, terminal failure, suppression, or the retention limit.
Sender-verification checks now use the same post-commit worker boundary.
