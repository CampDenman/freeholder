---
"freeholder": patch
---

Generating an image description no longer ties up a database connection while
Freeholder reads the preview or waits for the configured AI provider. Other
work can continue normally during a slow model response. Freeholder rechecks
the image bytes and authored description before saving the reviewable proposal,
so an edit made while generation is running always wins.
