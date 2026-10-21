---
"freeholder": patch
---

C8.16: Permission to publish a client's work is now a ledger rather than three columns, and taking it back no longer destroys the proof it was ever given. `projects.revokeConsent` used to set `client_consent_given_at`, `client_consent_method` and `client_consent_note` back to NULL — so a clinic that had published lawfully for six months could no longer show that it had, at the exact moment that record starts mattering. §4.18 is explicit that a withdrawal unpublishes *without deleting*.

Consent moves to `media_consents` in `core/privacy`, in the shape `consent_records` has used all along: immutable proof of one decision, with the current state derived from the history. A withdrawal is a new row. The existing grants are carried across by the migration rather than dropped, because they are the same evidence. Consent is scoped to the work it covers rather than to the person, because somebody who agreed to one before-and-after has not agreed to every photograph of them the business will ever hold — and a model that cannot express that difference will eventually be used as though they had.

Grants can now lapse. Consent given for a period was previously unrepresentable, which meant consent that had quietly run out read exactly like consent that still held. `liveConsent` answers false for a withdrawal, false for a lapsed grant, and false when nobody ever decided, and the publishing path does not distinguish them: all three mean do not publish. Decisions are ordered by when they took effect rather than when they were typed, so a consent form entered late cannot silently reinstate a permission somebody had already taken back.

Project media gains a `series` role with a `series_key` and a `captured_at`, because orthodontic progress and a recovery timeline are ordered over time and a before/after pair cannot express that. `captured_at` is when the picture was taken, not when it was uploaded — the distinction the whole of §4.18 turns on.

Both new tables record their actor as text (`user:<id>`, `agent:<name>`, `system`) following `audit_log`, not as a foreign key to users: an actor is not always a person, and a uuid column would assert something untrue of every row an agent or a scheduled job writes. `media_consents` joins the contact spine — repointed on merge, exported on request, and on erasure its decisions are kept while the free-text note is cleared, since the rows are evidence under a legal hold and the note is where somebody's own words could end up.
