---
"freeholder": patch
---

Fixed modules not actually being wired up on a running instance: features that
react to something happening elsewhere in the platform — like your site being
created when you finish setup — silently did nothing.
