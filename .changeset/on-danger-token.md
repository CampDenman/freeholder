---
"freeholder": patch
---

Fixes unreadable text on every destructive button. The colour reserved for
text on a red background was being dropped before it reached the page, so
"Delete", "Submit refund" and everything like them rendered dark grey on red —
about half the contrast accessibility requires. The colour itself was always
correct; it was being lost in transit.
