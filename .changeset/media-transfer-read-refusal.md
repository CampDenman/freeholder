---
"freeholder": patch
---

C11.08: stop a Replit media transfer when the source or target cannot be read.
Only an explicit provider 404 is treated as a missing object. Permission
refusals and provider errors can no longer cause an occupied target object
to be overwritten and reported as successfully restored.
