---
"freeholder": patch
---

C6.11: Events and classes now carry the evidence the rest of the checklist
requires. The module was already built — venue, sessions with capacity, ticket
types, waitlists that promote on cancel, check-in, Event JSON-LD and ICS — but
nobody had ever looked at it in a browser, so the accessibility pass over its
public and admin surfaces had never run in either theme, and it shipped no demo
fixture. Both are now in place: a public index and event page a visitor can
find, a sold-out session that states zero seats left rather than staying silent
about it, a calendar link proven to return a calendar, and a demo sourdough
class in English, French and Spanish that the tracked demo run loads, verifies
and purges.
