---
"freeholder": patch
---

Permanently deleting a trashed file now removes it from the library before
Freeholder talks to object storage. If deleting the bytes is interrupted, the
leftover objects stay as sweepable litter rather than a library file that
points at missing originals. Owner confirmation and the thirty-day trash
window are unchanged.
