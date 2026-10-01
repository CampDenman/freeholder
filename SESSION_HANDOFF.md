<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-10-01, C2.25 closed and freeholder.ai redeployed

This is a resumption snapshot, not another roadmap. **Read `CLAUDE.md` and
`MASTER.md` first; MASTER is the sole product, architecture and status
authority.** Refresh GitHub and run `pnpm plan:check` before relying on any
count or PR state below. This file replaces the 2026-09-26 snapshot; that one
(and earlier ones) remain in Git history — see "Carried forward" below for what
from it is still open.

## Where things stand

Version stays **0.1.0**. Not DONE, not a release candidate. Plan gate:
**302 unique IDs, 287 checked, 15 open**. Three of the 15 are real C-items —
**C11.10, C11.16, C11.17** — and the other twelve are §43.2's permanent
per-item F-template rows, which re-run at the final gate rather than being
work. Mobile is v2 by the owner decision of 2026-09-15 (§43.18).

Between 2026-09-26 and today a long Kimi session (2026-09-15 → 09-29) landed
roughly seventy PRs across Freeholder and paradisemodern: Paradise Comms as
the video provider (Daily removed), the world-class storefront (C3.24–C3.26:
collections, facets/search, public cart → checkout), the visual editor
overhaul (C2.24/C2.25: inline canvas editing, drag-and-drop, store sections),
the C11.08 live restore drill and C11.11 reference-target evidence. Read
`deploy/release-notes-2026-09-27.md` through `-2026-10-01.md` for detail.

This session (2026-09-30 → 10-01) merged:

- **#456** — ten Dependabot bumps in one lockfile (incl. `next` 16.3.6, which
  clears critical GHSA-vcvr-r3jv-pc5j) and two flaky-test fixes.
- **#459** — the canvas could swallow typing: the invisible reload from #455
  swapped frames under the owner's caret. Real product bug, now fixed.
- **#457** — upload and crop/focal point on the canvas; **closes C2.25**.
- **#460** — the droplet recipe's nightly backup never ran (unexported env).
- Closed unmerged: #418 (superseded by #424/#426) and #431–#440 (rolled into
  #456).

And **moved freeholder.ai to a new droplet running current `main`** — see the
next section.

Standing authorization, unchanged: routine repository work — branches, PRs,
merges, gates, docs — proceeds autonomously. Account passwords, API tokens and
device passcodes are entered by the owner only, never in chat, commits or test
artifacts. That includes creating the production owner account.

## Production

`freeholder.ai` runs on a new `freeholder-prod` droplet in the owner's **main**
DigitalOcean account (the one this workstation's `doctl` default context
reaches), built from `deploy/digitalocean-droplet/` with no deviations except
the cron fix that became #460. Host address, bucket names, key names and SSH
access are deliberately **not** in this public repository; the owner keeps
them with the droplet's secrets, outside the repo.

- **Stack:** `/opt/freeholder` — Caddy, app, Postgres via compose. The app
  image is pinned by **digest** in `.env` (`FREEHOLDER_IMAGE`), currently the
  build of `main` at #457. `.env.pre-cutover` on the box is the pre-switch
  copy.
- **Storage:** two private Spaces buckets in sfo3 (media; versioned backups)
  and one key scoped to only those two.
- **Backups:** `/etc/cron.d/freeholder-backup`, 03:15 UTC, logging to
  `/var/log/freeholder-backup.log`. A manual run uploaded and restored cleanly
  (363/363 tables). **Check tomorrow that an archive appeared on its own** —
  `verify.md` asks for it, and nobody has seen the cron fire yet.
- **Deploying an update** is still manual on the forge until a `freeholder`
  repository exists there (push-to-create is off; it needs a token). The
  in-repo job is `.forgejo/workflows/deploy-production.yml`, described in
  `deploy/digitalocean-droplet/deploy.md`. It pins the linux/amd64 digest of
  a published `sha-<12>` image after attestation, backs up, then
  `docker compose pull && docker compose up -d`, and waits for
  `schema is up to date`. Host addresses stay in Forgejo secrets. Until that
  repository exists, the same steps by hand are in `deploy.md`.
- **The owner account had not been created** at hand-off time; the owner does
  `/setup` with the bootstrap secret from the droplet's `.env`. Until then
  `/admin` redirects to `/setup`.
- **The old droplet** (still answering `demo.freeholder.ai`) lives in a
  different DigitalOcean team — apparently shared with campdenman.com — that
  no token on this workstation can see. It holds no real data per the owner.
  Delete it once the owner finds that team.

DNS for freeholder.ai is at NameSilo (owner's account; `@` and `demo` A
records). NameSilo's three authoritative servers published the change several
minutes apart — wait until all three agree before pointing Caddy at a new
name, or Let's Encrypt's failed-validation limit becomes the problem.

## The one thing to do first

Nothing is red or in flight. Pick by owner priority from:

1. **Wire the deploy pipeline to the forge.** The job, the digest pinning
   and the refusal to store a host address are in the repository
   (`.forgejo/workflows/deploy-production.yml`,
   `deploy/digitalocean-droplet/deploy.md`). What is not done, and cannot be
   done from here: create the `freeholder` repository on the forge
   (push-to-create is disabled), give the release runner the
   `freeholder-release` label, and set the secrets that doc names. GitHub
   remains the wrong place for that job.
2. **The public playground** on its own disposable instance for
   `demo.freeholder.ai` (C1.38's contract: `FREEHOLDER_PLAYGROUND=1`, blocked
   egress, nightly reset), then repoint `demo`.
3. **The C11.10 audit loop** below, when the owner calls it.

## C11.10 — how the owner wants to run it

No reviewer is named, deliberately. When the owner is ready, they will run
Codex, Claude, Kimi and Grok as repeated audit rounds until each is satisfied,
and only then designate a human reviewer. Write findings so the next agent can
pick them up. `security/independent-review-packet.md` is dated 2026-09-12 and
predates the storefront, the Paradise Comms adapter and the editor overhaul —
refreshing it is the useful first step of round one.

## Carried forward from 2026-09-26 (not re-verified this session)

Third-party findings still believed open — re-check each before working it:

- **Droplet recipe gaps** (the third party's deployment report): no CA-cert
  support, so pg-boss cannot reach a DO *managed* database over TLS while
  postgres.js can; no bucket CORS step, so the first admin upload can fail;
  `www` unserved (single Caddy site block — `www.freeholder.ai` has no DNS
  record either); SMTP documented on 587, which DigitalOcean blocks on
  droplets, while the adapter only does implicit TLS on 465. The App Platform
  recipe's `production: false` dev database cannot `CREATE SCHEMA`. The cron
  item is fixed (#460).
- **Media pair:** URLs re-signed every 900 s (uncacheable, 403 on long-open
  tabs); local media lacks `ETag`/`Last-Modified`/`Content-Length`/`Range`.
- **#17, #10, #13:** form errors wipe fields; plugin blocks cannot declare
  their heading level; `--fh-measure` caps header/footer/columns at 48rem.
- **#8, #7, #11** are features — scope #7 and #11 with the owner first.

The reports themselves are not in this repo; they were three files in the
owner's Downloads on the Windows machine. Ask for them.

Owner decisions still pending from that snapshot:

- **`forms.get` disclosure** (fixed in #412, never announced): advisory,
  notify known instances, or leave it.
- **Release versioning:** no `v*` tag has ever existed and ~399 changesets
  are unconsumed; four `major` declarations make the first `changeset
  version` land on **1.0.0** while MASTER says "not DONE". Settle that
  tension before running it. `.changeset/no-live-phone-example.md` had a
  UTF-8 BOM to fix first.
- **§4.8 ReleaseNote auto-draft** (S7 in `deploy/doc-claim-mapping.md`) has no
  owning C-item.

## Traps this session hit, so you do not

- **An "intermittent" browser failure was a real bug.** The merge queue
  flaked twice on `editor-inline-editing.spec.ts` right after a dependency
  bump, which looked like a dependency problem. It was #455's frame swap
  racing the owner's caret; pinning a package back would have hidden data
  loss. Reproduce under CPU contention (`--repeat-each 20` with the browser
  and server on two busy cores) before blaming the bump.
- **Image tags are 12-character SHAs** (`sha-e3de64e9272a`), not 7.
- **`gh attestation verify` checks the platform manifest**, not the
  multi-arch index digest compose pins — resolve the `linux/amd64` digest
  from the index first, or it 404s.
- **`doctl spaces` cannot create buckets.** Use the S3 API (the repo's own
  `aws4fetch` works) with a temporary full-access key, then delete that key
  and issue a bucket-scoped one. `doctl spaces keys delete` takes no
  `--force`.
- **Remove worktrees when their PR merges.** The Kimi session left 27 sibling
  worktrees (`../freeholder-*`), all merged; they were removed this session.
  Before removing one, confirm its branch's PR merged and that it holds no
  uncommitted work — a squash merge means `git branch --merged` will not tell
  you.
- From the 2026-09-26 snapshot, still true: generated SDK and CHANGELOG are
  gated against a fresh run (`node scripts/generate-sdk.mjs`,
  `node scripts/generate-changelog.mjs`); route handlers never touch the
  database; browser specs seed with inserts, not `service.call`;
  `plugins/wevibe-industry/` must never be committed to this public repo.
