---
"freeholder": minor
---

Complete account and broadcast mail delivery. Gmail and Microsoft mailboxes
connect through least-privilege delegated OAuth; SMTP remains an account-mail
option; Resend, Postmark and Amazon SES provide the broadcast route with
authenticated delivery, bounce and complaint feedback.

Admin Settings now shows both routes, sender verification and reconnect
health, default/pause/test controls, recent delivery evidence, and exact-address
suppression release in English, French and Spanish. First-run setup and doctor
report secret-free configured, pending, missing and broken states without
making a real or billable provider send.

Password resets, portal links, invitations, security notices and form
notifications share one delivery path. Message bodies and raw webhook payloads
are never retained; provider effects are idempotent and non-regressive, and
permanent bounces or complaints suppress the address until a person verifies
and releases it.
