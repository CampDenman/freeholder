---
"freeholder": patch
---

Generating an image description no longer keeps a database transaction open
while Freeholder reads the preview or waits for the configured AI provider.
The image and authored text are checked again before the reviewable suggestion
is saved, so edits made while generation is running always win.
