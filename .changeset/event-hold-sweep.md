---
"freeholder": patch
---

Expiring lapsed seat holds now handles each hold on its own. If one hold
cannot be released, for example because the next person on the waitlist can
no longer be emailed, the other holds are still released, and a hold that
keeps failing no longer holds up holds that lapsed after it.
