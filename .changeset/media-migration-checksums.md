---
"freeholder": patch
---

Moving your media to new storage now checks every original file against the
checksum recorded when you exported your site, before anything is copied, so a
file that was damaged in the old storage is caught instead of being carried
over. Exports with duplicate or contradictory entries are refused up front.

The transfer never overwrites anything already in the new storage. If a file is
already there with exactly the same contents, it is skipped and counted as
transferred, so an interrupted move can simply be run again. If a different file
is already at the same name, the transfer stops and names it without writing
over it. A dry run (`--dry-run`) shows what would be copied, skipped or refused.

Storage endpoints must use HTTPS. If you deliberately need plain HTTP to a
storage server on your own network, pass `--allow-insecure-http` (or set
`MEDIA_TRANSFER_ALLOW_INSECURE_HTTP=true`); the transfer prints a warning when
it does (C3.19).
