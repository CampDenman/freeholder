---
"freeholder": minor
---

Freeholder can now keep files wherever you keep them. DigitalOcean Spaces,
Cloudflare R2, MinIO, Backblaze and Amazon S3 all work through one setting, and
Replit's own storage works when you deploy there — switching between them is a
line of configuration, not a change to the software.

Private storage is the default. If your bucket is not meant to be public,
links to your files are signed and expire, so a client gallery link cannot be
forwarded to the whole internet by accident.
