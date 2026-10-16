<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-10-16: members platform (C12) merged and freeholder.ai redeployed

This is a snapshot for resuming work. It is not another roadmap. **Read
`CLAUDE.md` and `MASTER.md` first. MASTER is the only authority on product,
architecture and status.** Before you rely on any count or PR state below,
refresh GitHub and run `pnpm plan:check`.

This file replaces the 2026-10-01 snapshot, which is still in Git history. The
"Carried forward" section at the end lists what is still open from it.

The session was a Claude Code session, 2026-10-14 → 10-16, and the next one is
Codex. For what shipped, see `deploy/release-notes-2026-10-16.md`.

## Where things stand

The version is **0.2.0-beta.3**: not DONE, and not a release candidate.

The plan gate on main reads **350 unique IDs, 323 checked, 27 open**. Of the 27,
twelve are §43.2's permanent F01–F12 template rows, which are re-run at the
final gate and are not work in themselves. The rest are real items.

**Main is `92504696` and is deployed.** There are no in-flight merges, no
running agents and no background watchers. The scratch Postgres used for local
tests has been stopped.

## Production

freeholder.ai runs main `92504696`. The image is pinned in the droplet's `.env`
to this linux/amd64 digest:

`ghcr.io/campdenman/freeholder@sha256:68f16cda645c4665205f904b725f14a55a1d35febc3bd7892d71079b8a8d61e8`

After the deploy, `/readyz` was healthy, with 93 jobs and 1 worker.

As before, the host address, bucket names and SSH access stay out of this
public repository.

How to deploy:

```bash
node scripts/deploy-droplet.mjs --dry-run   # resolves the published digest, prints the plan
node scripts/deploy-droplet.mjs             # pins, backs up, pulls, waits for readiness
```

`resolvePublishedDigest` finds the `sha-<12>` image that CI publishes from
main. The script does not roll back on its own. When readiness failed this
session, the owner chose to fix forward. To roll back, re-pin the previous
digest by hand.

## Open PRs that need judgement

- **#539 — `freeholder launch`, proposed as the next C3 item (`feat/cli-launch`, Claude). Do NOT
  merge.**
  - The PR is complete and its tests are green. The tests use fakes only, and
    no real infrastructure has ever been launched.
  - To finish the item:
    1. The owner runs one real launch with `--dry-run` first, then real, then
       `--destroy`, against a throwaway domain.
    2. Record that as the evidence.
    3. Check the item.
  - The code is in `packages/cli/src/launch/`. `command.ts` holds the real
    wiring, and `index.ts` stays free of `child_process`.
- **#529 — four new C3 items: optional PM mail, measurement, form screening and
  Brain (opened by domainersuite, not this session).**
  - It **proposes the same C3 IDs as #539**, so whichever of #529 and #539 merges
    second must renumber its items.
  - IDs must stay contiguous, or `plan:check` fails.
- **Dependabot #478–#500.** These have not been reviewed. Batch them into a
  single lockfile PR, as #456 did.

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
- C11.10 (independent security review). The owner runs it as rounds of
  Codex, Claude, Kimi and Grok audits until all are satisfied, then names a
  human reviewer. No reviewer is named, deliberately. Refresh
  `security/independent-review-packet.md` first; it predates all of C12.

**Buildable without the owner, in MASTER order:**

- C3.29 (living screenshots: keep them refreshed on every change to main);
- C6.11 (events and classes with sessions and seat inventory);
- C9.37 (the newsletter sending journey);
- C9.38 (public membership discovery and signup, through to entitlement);
- C11.05 (entitlement proof);
- C11.08 (fresh install and upgrade proofs);
- C11.16 (reconcile §§1–42 against the code);
- C12.38 (sellers as merchant of record).

**C11.17** says "DONE" in its title but is unchecked. Verify its evidence
before checking it.

## Traps this session hit, so you do not

- **Changing an onboarding definition without bumping its version bricks boot
  on existing sites.** The worker refuses to sync, and readiness returns 503
  `no_live_producer`.
  - `tests/core/onboarding-definitions-frozen.test.ts` now catches it.
  - Bump `version` whenever you change a definition. Run
    `ONBOARDING_FREEZE_ADD=1` only when adding new entries, never to "fix" a
    changed one.
- **Vitest swallows `console.log` from inside the test environment.** To get
  diagnostics out, write them to a file.
- **A merge watcher must check CodeQL _alerts_, not only check names.** #534
  merged with two real alerts because its check passed by name. Check with
  `gh api repos/CampDenman/freeholder/code-scanning/alerts?ref=...`.
- **MASTER C-IDs must be contiguous within a section.** A matrix row is
  required for every new item. After a merge of MASTER.md, look for a
  duplicated matrix block.
- **After a merge, regenerate the SDK and CHANGELOG; do not hand-merge them:**
  `node scripts/generate-sdk.mjs`, `node scripts/generate-changelog.mjs`.
- **`pnpm gates` lint needs an 8 GB heap.** The script already sets it, so do
  not run eslint bare.
- **Migrations are hand-written SQL plus `drizzle/meta/_journal.json`.** The
  latest is **0051** (abuse_reports). Take the next number from the journal.
- **New services must be added to the inventory in
  `tests/core/internal-services.test.ts`.**
- **`media.rescan` must keep the legal-hold check.** The rescan source has to
  carry `scanEngine`, or held evidence can be rescanned away.
- **Tests must not contain marker strings that random bytes can produce.** A
  four-digit marker collided with random ciphertext once. Use words.
- **Local Postgres for the database tests:** an embedded Postgres on
  `127.0.0.1:55432`. Point `DATABASE_URL` at your own instance; the session
  scratch one is gone.
- **Git and process hygiene:**
  - Push with `git push origin HEAD:<branch>`, never by upstream and never
    with force.
  - Merge only through the merge queue.
  - Sign off every commit (`git commit -s`).
  - Background watchers use `gh` only. They never run git in a working tree
    someone is editing.
  - `pkill -f` patterns that are too broad kill your own watchers.

## Standing rules, unchanged

- Owner passwords, API tokens and device passcodes are entered by the owner,
  never in chat, commits or test artifacts.
- No secret is ever printed. `freeholder launch` redacts generated secrets
  from all output, and the claim link is shown once.
- Members never see the "Paradise Modern" name. Member-facing legal entities
  are Samia Harris Enterprises, Inc. and Camp Denman Society.
- Camp Denman's 18+ options stay, and they are hidden from minors (C12.29).
- `plugins/wevibe-industry/` must never be committed to this public repo.

## Carried forward from 2026-10-01 (not re-verified this session)

- **The deploy pipeline is not yet wired to the forge.** The job is
  `.forgejo/workflows/deploy-production.yml`. It still needs:
  - the `freeholder` repository created on the forge;
  - the runner label;
  - the secrets.

  Until then, `scripts/deploy-droplet.mjs` is the path.

- **A public playground for demo.freeholder.ai** on a disposable instance, as
  C1.38 specifies. The old demo droplet is in a DigitalOcean team that this
  workstation cannot see.
- **Droplet recipe gaps from the third-party report:**
  - CA certificates for a managed database;
  - bucket CORS;
  - SMTP on port 587.
- **Media findings:**
  - URLs are re-signed every 900 s;
  - local media is missing `ETag` and `Range`.
- **Findings #17, #10 and #13.**
- **Owner decisions still pending:**
  - the `forms.get` disclosure;
  - release versioning, because the first `changeset version` would land on
    1.0.0;
  - an owning item for the §4.8 auto-draft of release notes.
