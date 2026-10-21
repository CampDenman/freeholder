---
"freeholder": patch
---

Confirming a capture or generating a social variant no longer holds a
database connection open while Freeholder scans the staged file and builds
renditions. Leftover objects from a failed confirm stay as sweepable litter.
