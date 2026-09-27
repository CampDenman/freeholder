---
"freeholder": patch
---

C6.18: service-area coverage is now enforced, not just described. When a business has named the postcodes it delivers to, checkout re-checks the order's destination against that list in the same transaction and refuses — cleanly, before anything is written — a postcode the owner did not name. A postcode one character off a listed code counts as outside: the match is exact, never a prefix, radius or guess, and a business that named a radius, a region, or nothing at all is never asked to honour a boundary the software invented. Each area can also carry the weekly delivery days and hours it receives deliveries, which the coverage check on the page now shows alongside its yes.
