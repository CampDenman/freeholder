---
"freeholder": patch
---

Adding watermarked proofs to photographs that predate the feature no longer
holds a database connection open while Freeholder reads the original and
writes the marked renditions. If the file changes before those marks are
attached, leftover objects stay as sweepable litter rather than becoming a
library file that points at missing bytes.
