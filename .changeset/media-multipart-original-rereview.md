---
"freeholder": patch
---

C1.12/C11.08: preserve an authenticated upload's first identity when late
original storage evidence arrives, and allow a fresh verification of that same
idle upload after an earlier retirement review. New reads and complete
inventories append a new review while original stop receipts and results stay
unchanged. No storage mutation is replayed; compact evidence cleanup and full
media protocol availability remain gated.
