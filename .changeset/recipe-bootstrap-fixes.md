---
"freeholder": patch
---

Deploying to your own server now actually works end to end. Three things were
stopping it: the server setup script was silently ignored, starting the site
left you with an empty database and an error page, and the published image
could not be told where to keep your files. Fixed, with tests so they stay
fixed.
