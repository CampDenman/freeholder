---
"freeholder": patch
---

Make the controlled payment path measurably cheaper without relaxing a single
money guard. The raw-target classifier re-derived the whole authenticity verdict
for every calendar fact it examined, because `exactCalendarSnapshot` called
`calendarRead(target)` without the verdict its caller had already computed; that
one omission re-verified every operation, caller signature, raw fact and
verification of the journal tens of thousands of times per acceptance. The
verdict is now threaded in, as the surrounding readers already do. The scope
digest in the same verdict, and in the coverage reader's operation loop, is
hoisted out of the loop that recomputed it per row, and the retained journal's
value clone no longer allocates an entries array and a pairs array per object.

No freshness read, certificate, comparison or refusal changed: every digest,
signature check and journal read still happens exactly where it did, and the
`before`/`after` journal certificates are untouched. Measured back to back on a
tmpfs PostgreSQL 16, `atomic-credit-fee-persistence84` goes from 131.2s / 104.1s
/ 105.0s per test (343.5s for the file) to 116.9s / 92.7s / 92.7s (305.4s), and
`atomic-credit-stage-profile89` from 139.0s to 119.0s, with its
`actualAtomicCreditSource84` fixture stage 61.8s to 54.2s and its
`acceptControlledProration` stage 70.7s to 59.4s. The same functions run on
customer-facing controlled-provider paths, so the saving is product behaviour,
not test behaviour.
