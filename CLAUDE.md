# Freeholder — agent instructions

`MASTER.md` is the only product, architecture, status, and delivery source of
truth. Read it before making any product decision and select work from its §43
checklist. If a change contradicts the master doc, stop: either the change is
wrong, or the doc must be updated in the same PR. Do not create another roadmap
or backlog.

## Non-negotiables

- **Unified contact spine.** Every module (commerce, booking, quotes,
  galleries, email, analytics) reads and writes the same contact record.
  Never create a module-private notion of "customer".
  One contact per email address, enforced by a unique index. Automated paths
  (forms, checkout, imports, referrals) call `contacts.resolve` — never
  `contacts.create`, which is for deliberate entry by a human. Anonymous
  surfaces reach it through `ctx.callAsSystem`.
  **A module that adds a `contact_id` column must repoint it in
  `contacts.merge`.** Merge is a hand-maintained list, not a reflection over
  the schema: a table missing from it orphans rows the first time an owner
  merges two duplicates, which is the exact silent fork the spine exists to
  prevent.
- **One transaction per mutation.** Services compose with `ctx.call` and
  `ctx.callAsSystem`, which reuse the caller's transaction and its event
  queue. Never call `someService.call(...)` from inside another handler: that
  opens a second transaction on a second connection, so half the mutation can
  commit while the other half rolls back. Elevation is `ctx.callAsSystem` and
  nothing else — it is deliberately greppable.
  One sanctioned exception exists: `mail.completeOAuth` commits its one-time
  state claim on a second connection before exchanging the provider code,
  because provider codes are single-use and rolling the claim back would
  advertise an impossible retry. The rationale and its pool-deadlock caveat
  live at the call site in `src/core/mail/oauth.ts`. Do not add a second
  exception without recording it here.
- **Single-tenant.** One deploy = one business. No tenant-isolation
  abstractions.
- **Monolith + toggleable modules.** No microservices. Adapters for the
  swappable edges: payments (Stripe default, PayPal), mail
  (Google/Outlook OAuth for transactional, provider adapter for bulk),
  storage (S3-compatible), SMS.
- **Light and dark are both first-class.** Every surface ships in both, and
  every colour comes from a semantic token in `src/core/design/tokens.ts` —
  never a literal, and never a value that only works on one ground. The theme
  is resolved server-side from a cookie and stamped on `<html>`, so no screen
  implements its own toggle or reads `prefers-color-scheme` directly. New
  colour pairings must clear WCAG AA in *both* schemes; `tests/core/tokens.test.ts`
  enforces it, so a token that fails is a failing build.
- **Licensing.** Freeholder-authored code, documentation, and packages use
  `Apache-2.0`. New files carry the SPDX header shown in `LICENSING.md`;
  third-party material retains its own license and notice.
- **Replit-first deployability.** Changes must not break single-command
  deploy. Seed/demo mode must keep working.
- **SEO as architecture**, first-party analytics, KISS auth
  (email + password + OTP for owners, magic links for customers).

## Conventions

- Name the §43 checklist ID in every product change. Split oversized items in
  `MASTER.md` before coding and check them only with the evidence §43 requires.
- Commits are signed off (`git commit -s`) — DCO, no CLA.
- `main` is protected: PR + green checks only.
- Release notes are religion: every user-facing change gets a note.
