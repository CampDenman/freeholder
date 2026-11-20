---
"freeholder": minor
---

Renewal alerts (C12.40): a new module, off by default, that warns a member before a subscription somebody else bills them for renews. Track what you pay for, choose how many days of warning you want, and get one plain notice per charge. It is not the billing module — nothing here charges anybody or touches a payment provider. Your register lives in your own portal, beside everything else you have with the business, and you can add a charge, correct one, or stop being warned about it without asking anyone. One alert per renewal is enforced by the database rather than worked out from a timestamp, the look-ahead runs as a scheduled job rather than a timer inside the web process, and asking to be forgotten deletes the register outright instead of anonymising it. No alert has been delivered by this code yet.
