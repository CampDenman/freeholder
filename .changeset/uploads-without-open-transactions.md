---
"freeholder": patch
---

Uploading a file no longer holds a database connection open while Freeholder
talks to object storage or the malware scanner. Direct uploads can still be
resumed if the store already has the bytes. If an upload is aborted or fails
checks, leftover objects stay as sweepable litter rather than becoming a
library file that points at missing bytes.
