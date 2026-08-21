---
"freeholder": minor
---

Calendars have hours now. Open a calendar and set its week — from and until for
each day, with a separate on-call band for hours somebody is reachable but not
bookable. Leave a day empty and it is closed.

Days that break the pattern are separate: a bank holiday, a late start after
training, an extra Saturday, or a Christmas closure spanning two weeks. A day
listed there overrides the weekly hours completely, and a closure always wins —
if you have somehow written both a closure and an opening for the same day, the
day stays shut, because that is the reading that will not take a booking you
cannot honour.

Hours are written as local times and stay put when the clocks change. Nine in
the morning is nine in the morning in March and in July.

Nothing is precomputed. When something asks when a calendar is open, the answer
is worked out from the pattern and the exceptions at that moment — so a closure
you add takes effect immediately rather than when a cache happens to expire.

The engine that turns these hours into bookable slots comes next.
