<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-10-17: C6.11, C9.37 and C9.38 merged, freeholder.ai redeployed

This is a snapshot for resuming work. It is not another roadmap. **Read
`CLAUDE.md` and `MASTER.md` first. MASTER is the only authority on product,
architecture and status.** Before you rely on any count or PR state below,
refresh GitHub and run `pnpm plan:check`.

This file replaces the 2026-10-16 snapshot, which is still in Git history.
For what shipped, see `deploy/release-notes-2026-10-17.md`. The 2026-10-16
digest remains `deploy/release-notes-2026-10-16.md`.

## Where things stand

The version is **0.2.0-beta.3**: not DONE, and not a release candidate.

The plan gate on main reads **350 unique IDs, 326 checked, 24 open**. Of the
24, twelve are §43.2's permanent F01–F12 template rows, which are re-run at
the final gate and are not work in themselves. The twelve real open items are
C3.28, C3.29, C11.05, C11.08, C11.10, C11.16, C11.17, C12.26, C12.27, C12.30,
C12.38 and C12.39.

**Main is `5af2cf0c`, and that is the deploy.** Since the 2026-10-16 snapshot,
#541 (the Dependabot rollup), #540 and #542 (the handoff), #543 (C3.29's
gallery publisher, item still open), #544 (C6.11), #545 (C9.37) and #546
(C9.38) merged. There are no in-flight merges.

## Production

freeholder.ai runs main `5af2cf0c`. The image is pinned in the droplet's
`.env` to this linux/amd64 digest:

`ghcr.io/campdenman/freeholder@sha256:87eebf56dfe33d50ee14d523f32df715d00175de5984d19198aeceb7df561ea6`

The swap ran on 2026-10-17 after a database backup. The app logged that the
schema is up to date. `GET /api/health` returned ok: version 0.2.0-beta.3,
1,718 services, 94 registered jobs, one current worker, no failed jobs, queue
state ready. Health also reported three stale instances and still returned
ready. The homepage returned 200.

The previous pin, kept for a hand rollback, is:

`ghcr.io/campdenman/freeholder@sha256:68f16cda645c4665205f904b725f14a55a1d35febc3bd7892d71079b8a8d61e8`

The playground directory that serves demo.freeholder.ai was not swapped. It
still returned HTTP 200. As before, the host address, bucket names and SSH
access stay out of this public repository.

How to deploy:

```bash
node scripts/deploy-droplet.mjs --revision <40-char-sha> --dry-run
node scripts/deploy-droplet.mjs --revision <40-char-sha>
```

`resolvePublishedDigest` finds the `sha-<12>` image that CI publishes from
main, after the push CI succeeds and Publish image signs the linux/amd64
manifest. A merge-queue run is not that image. The script does not roll back
on its own.

## Open PRs that need judgement

- **#539 — `freeholder launch` (`feat/cli-launch`). Do NOT merge.**
  - The PR is complete and its tests are green. The tests use fakes only, and
    no real infrastructure has ever been launched.
  - To finish the item the owner runs one real launch with `--dry-run` first,
    then real, then `--destroy`, against a throwaway domain, and records that
    as the evidence.
  - The code is in `packages/cli/src/launch/`. `command.ts` holds the real
    wiring, and `index.ts` stays free of `child_process`.
  - The proposed checklist numbers are not in MASTER yet.
- **#529 — optional Paradise Modern mail, measurement, form screening and
  Brain.**
  - It proposes the same new C3 numbers as #539, so whichever merges second
    must renumber. Those numbers are not in MASTER. IDs must stay contiguous,
    or `plan:check` fails.

## Open plan items

**Blocked on the owner:**

- C12.26 and C12.27 (payouts). The code is merged in #536 but mocked. They
  need live Stripe Connect, PayPal or Razorpay keys, and the owner said "not
  yet".
- C12.30 (abuse imagery). It is merged in #537 and switched off. It needs a
  PhotoDNA agreement, which the owner will not sign up for now.
- C12.39 (move from `ts-mls` to OpenMLS). The owner deferred it on
  2026-10-16, because it needs a Rust/WASM build, and Replit-first deploy
  matters.
- C3.28 (fresh-account launch on Replit and Lovable). It needs the owner
  present.
- C3.29 (living screenshots on the instance). Capture and the `screenshots`
  branch run in CI. The gallery publisher merged in #543 and is proven on a
  local instance. It stays open until the owner adds the scoped credential
  in `deploy/screenshots-gallery.md` and one live gallery update runs on
  freeholder.ai.
- C11.10 (independent security review). The owner runs it as rounds of
  Codex, Claude, Kimi and Grok audits until all are satisfied, then names a
  human reviewer. No reviewer is named, deliberately. Refresh
  `security/independent-review-packet.md` first; it predates all of C12.

**Buildable without the owner, in MASTER order:**

- C11.05 (entitlement proof; live settlement, not another adapter double);
- C11.08 (fresh install and upgrade proofs);
- C11.16 (reconcile §§1–42 against the code);
- C12.38 (sellers as merchant of record).

**C11.17** says "DONE" in its title but is unchecked. Verify its evidence
before checking it. It stays open while any earlier item is unchecked, and
C3.28, C3.29 and the C11 items above are still open.

Closed on 2026-10-17, so they are not next: C6.11 (paid event admission),
C9.37 (newsletter sending; live inbox placement remains owner acceptance),
C9.38 (card-required trials; live settlement remains C11.05).

## Traps this session hit, so you do not

- **Changing an onboarding definition without bumping its version bricks boot
  on existing sites.** The worker refuses to sync, and readiness returns 503
  `no_live_producer`.
  - `tests/core/onboarding-definitions-frozen.test.ts` now catches it.
  - Bump `version` whenever you change a definition. Run
    `ONBOARDING_FREEZE_ADD=1` only when adding new entries, never to "fix" a
    changed one.
- **A merge watcher must check CodeQL alerts, not only check names.** #534
  merged with two real alerts because its check passed by name.
- **MASTER C-IDs must be contiguous within a section.** A matrix row is
  required for every new item. Do not cite a proposed ID in a tracked file
  until it exists in MASTER: `plan:check` refuses an unknown reference.
- **After a merge, regenerate the SDK and CHANGELOG; do not hand-merge them:**
  `node scripts/generate-sdk.mjs`, `node scripts/generate-changelog.mjs`.
  The changelog gate is empty before the commit and sees the changeset only
  after it.
- **`pnpm gates` lint needs an 8 GB heap.** The script already sets it, so do
  not run eslint bare.
- **Migrations are hand-written SQL plus `db/migrations/meta/_journal.json`.**
  The latest is **0052** (`0052_event_paid_admission`, paid event holds).
  C9.38 added no migration. Take the next number from the journal.
- **Push with `git push -u origin HEAD:<branch>`, never a bare `git push`.**
  A new worktree branch can have its upstream set to `origin/main`. Merge
  only through the merge queue. Sign off every commit (`git commit -s`).
- **Do not run `pnpm` from the workspace root** (`/home/tony/code`). That
  `package.json` is not Freeholder. Run it inside the Freeholder worktree.
- **The browser server's payment adapter is manual.** A Playwright run cannot
  show the card-setup form unless that default changes, and changing it
  breaks the offline-payment journey. The card-trial service is proven in
  Vitest. The browser spec proves an incapable adapter keeps the plan
  unavailable.
- **Local Postgres for the database tests:** `127.0.0.1:55432`, user and
  password `postgres`, on a database whose name contains `test`. `pg_isready`
  and `psql` are not installed on this workstation. Vitest maps
  `TEST_DATABASE_URL` onto `DATABASE_URL` and migrates itself.

## Standing rules, unchanged

- Owner passwords, API tokens and device passcodes are entered by the owner,
  never in chat, commits or test artifacts.
- No secret is ever printed. `freeholder launch` redacts generated secrets
  from all output, and the claim link is shown once.
- Members never see the "Paradise Modern" name. Member-facing legal entities
  are Samia Harris Enterprises, Inc. and Camp Denman Society.
- Camp Denman's 18+ options stay, and they are hidden from minors (C12.29).
- `plugins/wevibe-industry/` must never be committed to this public repo.
- Do not deploy by merging. Merging publishes an image only after main's push
  CI and the Publish image workflow. The droplet changes only when
  `scripts/deploy-droplet.mjs` pins that digest.

## Carried forward from 2026-10-16 (not re-verified this session)

- **The deploy pipeline is not yet wired to the forge.** The job is
  `.forgejo/workflows/deploy-production.yml`. It still needs the `freeholder`
  repository on the forge, the runner label, and the secrets. Until then,
  `scripts/deploy-droplet.mjs` is the path. This session used that script.
- **A public playground for demo.freeholder.ai** on a disposable instance, as
  C1.38 specifies. The copy on this droplet was left on its previous stack.
- **Droplet recipe gaps from the third-party report:** CA certificates for a
  managed database, bucket CORS, and SMTP on port 587.
- **Media findings:** URLs are re-signed every 900 s; local media is missing
  `ETag` and `Range`.
- **Findings #17, #10 and #13.**
- **Owner decisions still pending:** the `forms.get` disclosure; release
  versioning, because the first `changeset version` would land on 1.0.0; an
  owning item for the §4.8 auto-draft of release notes.
- **Mobile Dependabot alerts** on braces and node-forge have no published
  fix. They stay open until upstream patches.
