---
"freeholder": patch
---

Fixed subscribable calendar feeds returning an error instead of your diary. The
`.ics` links and the `/source` provenance endpoint failed on a cold server even
with a perfectly valid link; both now work on the first request.
