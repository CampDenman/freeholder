---
"freeholder": minor
---

Freeholder now reads the calendars you connected, so it knows when you are
already busy. By default it learns exactly that and nothing else: the times
that are taken, and whether they block. Titles, guests, locations and notes
are not stored at all unless you turn detail on for that account, and turning
it back off erases what was kept.

Each calendar on a connected account can be a source of busy time, one
Freeholder may book into, or ignored entirely. Ignored means ignored: it is
not fetched, and anything already read from it is deleted. Rediscovering it
later does not quietly switch it back on.

Syncing runs every fifteen minutes and is cheap when nothing has changed,
because it asks each provider only for what moved since last time. If a
connection stops working, Freeholder tells you it needs reconnecting — in the
provider's own words — instead of retrying quietly into a lockout, and one bad
connection never stops the others from syncing.
