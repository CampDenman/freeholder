---
"freeholder": patch
---

Fixed: a class or group session could be overbooked if two people booked the
last places at exactly the same moment. One-to-one appointments were already
safe — the database itself refuses those — but a shared calendar is meant to
allow overlapping bookings, so it was counting seats instead, and two
simultaneous requests could both count the same free place.

Seat counting is now serialised per calendar, so the second request sees the
first one's booking and is told how many places are actually left. Two people
booking different rooms still never wait on each other.
