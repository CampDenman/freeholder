---
"freeholder": patch
---

C1.12/C11.08: keep completed multipart files bound to their original upload and
verify the full stored revision before recording the file. Interrupted or
changed files remain available for recovery; completing a file does not claim
that every outstanding direct-upload link has been retired.
