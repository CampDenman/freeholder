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
  Provider I/O never happens in a service transaction. A synchronous flow
  that must cross a provider boundary uses `defineOrchestratedService` around
  ordinary short claim/apply services; an orchestrator refuses `ctx.call`, so
  it cannot be moved back under a caller's transaction by composition. OAuth
  state claims commit before single-use codes are exchanged, and provider
  responses are applied in a fresh transaction afterwards.
- **One site, many members.** One deploy = one site, with no tenant-isolation
  abstractions between sites. That site serves any number of members who
  publish, connect, message, call, buy and sell with each other (`MASTER.md`
  §44). When a choice is open, pick what is best for the people using the site.
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
  (passkeys for owners, password + OTP fallback, magic links for customers).

## Conventions

- Name the §43 checklist ID in every product change. Split oversized items in
  `MASTER.md` before coding and check them only with the evidence §43 requires.
- Follow `CONTRIBUTING.md` for Apache-2.0 contributions and ordinary PR review.
- The protected merge queue requires green `checks` for `main`.
- Release notes are religion: every user-facing change gets a note.
- **Before editing a file, check whether a `deploy/*.json` source record pins
  its sha256:** `node scripts/pinned-source-records.mjs <path>`. Those records form reversal ladders
  that several suites walk, so a correct one-line repair can redden
  `controlled-safe-response-composition87` or `tests/core/migrate-boundary.test.ts`
  with a failure that names a hash and not the file that moved. Move the
  records in the same commit. **Read the LIVE count, not the list.** MASTER.md
  has 3 live pins among 366 stale references; scrolling a long list of `STALE`
  rows and concluding "these are all historical, so editing is free" is how
  its live pin was broken on 2026-11-18 — after this tool had already reported
  it. The script now prints live pins first and ends with a count, because
  stale pins are history and a matching pin is a tripwire. Three cautions it
  prints and cannot enforce: a sha that looks replaceable may be a historical
  blob sha at a pinned commit (verify with
  `git show <commit>:<path> | sha256sum`); a record declaring
  `archivalEncoding` escapes every period as `\u002e`, so re-serializing it
  with a JSON writer silently discards that — edit those as text, and check
  any record round-trips byte-identically before rewriting it; and the script
  reads `deploy/*.json` only, so a sha hardcoded in a test file is invisible
  to it.
- **A pin does not have to sit beside a `path`.** The script used to collect
  shas only from record objects carrying `path: <your file>`, so
  `merchant-fee-xid-epoch87.manifest.json` — which pins
  `predecessors: { "0085": <sha>, "0086": <sha> }`, keyed by migration number,
  and whose test hashes `db/migrations/0086_*.sql` straight against it —
  was reported as *"named, but no sha256 on that path"*. The 0086 boundary
  repair on 2026-11-18 was therefore made believing 0086 had **no** live pin,
  and reddened that suite in a full run hours later. It now also reports any
  sha256 anywhere in a record that equals the file's current digest, because a
  digest of this content is a pin on this content whatever field holds it. The
  deeper rule: targeted suites confirm what you expected to touch, and only the
  whole suite finds what you did not.
