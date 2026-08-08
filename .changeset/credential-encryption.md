---
"freeholder": minor
---

Groundwork for connecting your Google, Microsoft and Apple accounts: a safe
place to keep the access they grant.

Nothing connects yet — that comes next — but the part that has to be right
before anything does is now in place. Access tokens are encrypted before they
touch the database, using a key that lives in your server's configuration
rather than in the database itself. Somebody who obtained a copy of your
database would get nothing usable out of it.

Two things follow that are worth knowing now rather than later:

**The key belongs in your backups**, alongside the database. If you lose it,
your connected accounts have to be reconnected — the data is not recoverable
without it, which is the point.

**Freeholder tells you before this bites.** The health check reports a missing
key as a warning while nothing is connected, and as a failure the moment
something is, with the command to generate one. It is not something you find
out about when a calendar quietly stops syncing.

You can also change the key without downtime: set the old one alongside the
new, and everything keeps working while it re-encrypts.
