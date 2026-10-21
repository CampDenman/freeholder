---
"freeholder": patch
---

The DigitalOcean droplet walkthrough's nightly backup now actually runs. The
cron line it gave loaded the settings file without exporting it, so the backup
script saw none of its settings and failed every night without a word. The
walkthrough now exports them, writes each run to a log you can check, creates
the versioned backup bucket the script needs, and scopes the storage key to
both buckets instead of the media bucket alone.
