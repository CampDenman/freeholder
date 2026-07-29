---
"freeholder": minor
---

Freeholder can be deployed to a DigitalOcean droplet you own, with a written
walkthrough that takes you from an empty account to a site on your own domain
with a certificate: create a bucket for your files, create the machine, point
your domain at it, fill in one settings file, and start it.

Your photos and files live in object storage rather than on the machine, so a
machine that dies is twenty minutes of rebuilding rather than losing your
archive — and the software now refuses to run in production with files kept on
the machine's own disk, instead of letting you discover the problem the hard
way. Database backups run nightly, and the checklist has you rehearse a restore
before trusting them.
