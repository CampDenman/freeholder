# Freeholder — agent instructions

`MASTER.md` is ground truth. Read it before making any product or
architecture decision. If your change contradicts the master doc, stop:
either the change is wrong, or the doc must be updated in the same PR.

## Non-negotiables

- **Unified contact spine.** Every module (commerce, booking, quotes,
  galleries, email, analytics) reads and writes the same contact record.
  Never create a module-private notion of "customer".
- **Single-tenant.** One deploy = one business. No tenant-isolation
  abstractions.
- **Monolith + toggleable modules.** No microservices. Adapters for the
  swappable edges: payments (Stripe default, PayPal), mail
  (Google/Outlook OAuth for transactional, provider adapter for bulk),
  storage (S3-compatible), SMS.
- **Licensing boundary.** Core is `AGPL-3.0-only`; everything under
  `packages/` is `MIT`. New files carry the SPDX headers shown in
  `LICENSING.md`. Never move code across the boundary without flagging it.
- **Replit-first deployability.** Changes must not break single-command
  deploy. Seed/demo mode must keep working.
- **SEO as architecture**, first-party analytics, KISS auth
  (email + password + OTP for owners, magic links for customers).

## Conventions

- Commits are signed off (`git commit -s`) — DCO, no CLA.
- `main` is protected: PR + green checks only.
- Release notes are religion: every user-facing change gets a note.
