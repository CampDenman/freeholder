---
"freeholder": patch
---
Late media recovery now coalesces identical queued erasure work instead of accumulating a job for every evidence read. Nested recovery locks recognize their owning transaction without weakening interactive conflict handling, and minimized retirement proofs reuse one intact-certificate verification per resource. Re-reviewed minimized operations retain exact human attribution without losing current certificate coverage. Certificate sealing computes the expected proof and identity once before applying the same authority predicate.
