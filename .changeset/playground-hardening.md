---
"freeholder": minor
---

The public playground is now hardened end to end. Visitors keep their restricted editing sessions, but every privileged operation is refused by the service layer itself — not just hidden in the interface — and outbound mail, text messages and webhooks can no longer leave a playground instance even from background jobs. The shared demo is bounded (300 edits a minute, row caps on each editable surface, uploads off), and the hourly reset now has an automated recovery proof: afterwards the old session is dead, visitor pages are gone, and the sample site is back.
