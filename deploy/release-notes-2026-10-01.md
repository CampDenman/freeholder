<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-10-01

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement. `CHANGELOG.md`, generated from
`.changeset/`, is the canonical owner-facing change list. Unlike earlier
digests, this one **does** record a deployment: freeholder.ai now runs current
`main` (see the last section).

Covers what merged after the 2026-09-30 digest: PRs #456, #459 and #460, plus
the production move.

## Typing is never lost to the canvas reload — PR #459 (C2.25)

C2.25 slice C (PR #455) made a save reload the canvas invisibly: the next
version loads in a hidden second frame and swaps in once it has rendered.
Nothing checked whether the owner was mid-edit in the visible frame. Save,
click straight into the next paragraph and keep typing, and the swap hid the
frame holding the caret; every keystroke after it went to an invisible frame
the editor ignores. Reproduced on `main` in a real browser: "Typed across the
swap, every letter." was stored as "Typed across the sw".

- The staged version now waits while the visible frame holds a caret in an
  editable, and swaps when the edit ends — Enter, a click elsewhere on the
  canvas, or a click outside it (a click is let through first, so "Replace
  image" mid-edit still opens its picker).
- Edits, clicks and drops from a frame that was just swapped out are still
  honoured; only load and height messages must come from the live frame.
- The canvas region is `aria-busy` while a newer version is pending, which is
  also what the browser journey now waits on instead of racing the swap.
- Known trade-off: Escape does not take the caret out of a canvas editable, so
  after Escape the old frame stays up until the next click or save. It already
  shows what was typed.
- **Proof:** a new unit case in `tests/core/editor-store-sections.test.ts`
  ("gap 5: a staged version never swaps in under the owner's caret") fails
  without the fix. `tests/browser/editor-inline-editing.spec.ts` went from 7
  failures in 20 runs under CPU contention to 0 in 30, both before and after
  the dependency roll-up below.

This surfaced as an "intermittent" merge-queue failure on #456 and #457. It
was a product bug; the dependency bumps only changed timing enough for CI to
hit it more often.

## Dependency roll-up and two test fixes — PR #456

Ten Dependabot bumps (#431–#440) applied in one lockfile resolution so they
would not conflict with each other in the merge queue: eslint 10.11.0,
drizzle-kit 0.31.11, @formatjs/icu-messageformat-parser 3.5.20, yaml 2.9.1,
intl-messageformat 12.1.2, **next 16.3.6**, drizzle-orm 0.45.3, vitest 5.0.2,
jsdom 30.1.1, @types/nodemailer 8.0.2. The `next` bump clears the critical
advisory GHSA-vcvr-r3jv-pc5j that the "Security and dependency evidence" gate
had started failing every PR on.

Two tests that failed independently of any bump were fixed:
`tests/core/client-galleries.test.ts` asserted a 4-digit PIN never appears in
a random UUID or hex hash (it can, by chance); `tests/core/apikeys.test.ts`
slept a fixed 120 ms for a fire-and-forget write and now polls with
`vi.waitFor`.

PR #418 (a 2026-09-26 handoff correction saying C10.06/C10.31 must stay open)
was closed unmerged as superseded: PRs #424 and #426 closed both items with
evidence before it could land.

## The droplet recipe's nightly backup actually runs — PR #460 (C3.17)

`deploy/digitalocean-droplet/README.md` installed the backup cron as
`. /opt/freeholder/.env && /opt/freeholder/backup.sh`. Sourcing without
exporting leaves `backup.sh` — a child process — with no variables, so it
exited on its first `BACKUP_BUCKET` check every night, silently. The
2026-09-26 third-party deployment report had already flagged this; it was hit
again standing up the new production droplet.

The cron line now uses `set -a; . .env; set +a` and logs each run; step 1
creates a versioned backup bucket and scopes the one storage key to both
buckets (`backup.sh` reuses the app's key, so a media-only key also failed);
`.env.example` gains `BACKUP_BUCKET`.

## Production: freeholder.ai moved to a new droplet

Until today freeholder.ai served a build from about 2026-09-16 — roughly 55
merged PRs behind — on a droplet in a DigitalOcean team this workstation had
no access to, with no recorded way to deploy to it. The owner confirmed it
held no real users or data, so instead of recovering access it was replaced:

- A new `freeholder-prod` droplet (`s-2vcpu-4gb`, sfo3) in the owner's main
  DigitalOcean account, built exactly from
  `deploy/digitalocean-droplet/` (cloud-init, compose, Caddyfile).
- Media and nightly database backups in two new private Spaces buckets (the
  backup bucket versioned), behind one key scoped to just those two buckets.
  The temporary full-access keys used to create the buckets were deleted.
- The app image is pinned by digest to the build of `main` at #457
  (`sha-e3de64e9272a`); GitHub's build provenance for it verifies against this
  repository's publish workflow.
- Verified before the DNS switch, on a throwaway hostname: TLS, HTTP→HTTPS
  redirect, no `x-powered-by`, only 22/80/443 open (Postgres and the app port
  closed from outside), `noindex` on `/login`, the bucket refusing anonymous
  listing, schema migrated and all 87 jobs mounted, a manual backup uploaded
  and **restored into a scratch database matching the live table count
  (363/363)**, and the site returning on its own after a reboot.
- `freeholder.ai`'s apex record was then repointed; Let's Encrypt issued its
  certificate and the site serves from the new droplet.

Not moved: `demo.freeholder.ai` still points at the old droplet. The public
playground (C1.38) must run as its own disposable instance with
`FREEHOLDER_PLAYGROUND=1` and blocked egress, not on the production box.

Merging to `main` still does not deploy. Updating production is, for now, a
manual image-digest change and `docker compose up -d` on the droplet.
