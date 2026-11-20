---
"freeholder": patch
---

C1.12/C11.08: copy call recordings and transcripts into owner storage through
original storage receipts, and remove them through the shared original-file
removal service. The voice and video plugin previously wrote and deleted
bytes with raw adapter calls, which the storage-authority guard refuses, so
recording import failed and recording erasure threw instead of deleting.
An already-stored recording is now recognised from its accepted original
receipt rather than a byte-length probe, so a retry still never writes the
object twice. An owner-storage copy whose original generation cannot be
proved retired keeps the privacy receipt in progress instead of acknowledging
an erasure that did not happen. Core recovery that follows a committed
physical fact now runs under core authority, so a write started inside a
plugin no longer leaves the import, transfer and crawl reconcilers refused
on permission while the plugin stays the audit origin.
