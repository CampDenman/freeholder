---
"freeholder": minor
---

Add the complete staff invitation lifecycle: create an expiring invitation for
an assignable admin role, deliver it through the configured transactional mail
adapter, rotate its private token on resend, revoke it immediately, and accept
it through a noindex password-creation screen that signs the new staff member
in. Invitation tokens are hashed at rest and redacted from audit and
rate-limit records; role eligibility is checked again at acceptance; duplicate
and concurrent acceptance are closed at the database boundary; expiry is
scheduled; delivery state and the plain-language audit history are visible in
the localized admin.
