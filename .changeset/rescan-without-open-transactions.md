---
"freeholder": patch
---

Rescanning a file no longer holds a database connection open while Freeholder
talks to the malware scanner or rebuilds image sizes. Other work can continue
during a slow scan. If someone edits or replaces the file while that work is
running, the edit wins and any new image sizes stay as leftover objects the
nightly sweep can remove — they are never attached to the wrong file.
