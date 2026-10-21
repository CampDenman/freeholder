---
"freeholder": minor
---

The optional assistant now quotes from what you have actually published.
Published pages, the catalog, opening hours and owner-written notes
(facts, Q&As, policies) are indexed in Postgres. A change to any of
those rebuilds the index. Switch a note off and it leaves the index.
The assistant is told to quote only from those notes; if a price or
opening time is not there, it says it does not have it to hand.
