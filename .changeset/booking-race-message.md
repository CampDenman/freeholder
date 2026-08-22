---
"freeholder": patch
---

Fixed: when two people booked the last slot at the same moment, the one who
lost sometimes saw a database error instead of "that time was taken while you
were booking it".

The booking itself was always correct — one person got the slot, never both.
But Postgres has three different ways of saying "somebody got there first"
depending on exactly how the two requests overlapped, and only one of them was
being turned into a sentence. The other two reached the person as raw SQL.

All three now say the same thing, because to whoever lost they mean the same
thing.
