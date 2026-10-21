---
"freeholder": patch
---

Security: `forms.get` is public and returned the whole form row, so any
unauthenticated caller could read `notify` — the addresses a site's form
submissions are e-mailed to. An owner who deliberately keeps their address off
their site had it published through the API, and `contact` is the obvious slug
to guess, so the addresses were harvestable across instances. The public service
now has its own named projection in both its output schema and its query, so
`notify` never leaves the database and a column added to the table later cannot
leak the same way. Notification sending is unaffected; it reads the column
through its own query. Reported by a third party building on Freeholder.
