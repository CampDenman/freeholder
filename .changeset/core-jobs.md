---
"freeholder": minor
---

Freeholder now does background work on a schedule: expired sign-in sessions and
old rate-limit counters are cleaned up on their own, and anything the site
needed to tell itself about — a form submission reaching your contacts, a page
being published — is recorded in the same breath as the change, so it still
happens even if the server restarts at exactly the wrong moment.
