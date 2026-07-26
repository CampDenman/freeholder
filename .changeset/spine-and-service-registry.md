---
"freeholder": minor
---

The contact spine is in place: every person the business touches now has one
record, and the system refuses to create a second one for the same email
address — a contact can be looked up or created in a single safe step, and two
records for the same person can be merged without losing their history.

Owner accounts, passwords and login sessions work, and setting up the owner
account can only ever happen once, even if the setup page is opened twice at
the same moment. Logging out ends your own session and nobody else's.

A misconfigured site now refuses to start and says exactly what is missing,
instead of appearing to work and failing at the first login.

Underneath, every action the software takes now runs through one gate that
checks permission, validates the request, writes an audit entry, and saves
everything or nothing — so a half-finished change to your data is impossible
rather than unlikely. Prices and dates are formatted correctly for every
currency and locale, including currencies that do not divide into hundredths.
