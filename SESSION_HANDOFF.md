<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-09-26, third-party findings and C6.11

This is a resumption snapshot, not another roadmap. **Read `CLAUDE.md` and
`MASTER.md` first; MASTER is the sole product, architecture and status
authority.** Refresh GitHub and run `pnpm plan:check` before relying on any count
or PR state below. This file replaces the 2026-09-16 completion-push snapshot;
earlier contents remain in Git history.

## Where things stand

Version stays **0.1.0**. This is not DONE and not a release candidate. Plan gate:
**297 unique IDs, 270 checked, 27 open**. Fifteen of the 27 are real checkboxes;
the rest are §43.2's permanent per-item F-template rows, which are not work. Seven
mobile items are excluded by the owner decision of 2026-09-15 (§43.18).

`main` is at **`445c09b3`**. Merged this session, in order: **#411** (five
owner-authored-truth features: C8.14, C8.15, C8.16, C5.26, C6.18), **#412** (the
`forms.get` disclosure fix), **#413** (four third-party defects), **#414** (C6.11
closed), **#415** (the C11.11 harness made runnable on Windows).

Standing authorization, unchanged: routine repository work — branches, PRs,
merges, gates, docs — proceeds autonomously. Account passwords, API tokens and
device passcodes are entered locally by the owner only, never in chat, commits or
test artifacts.

## The one thing to do first

**#416 (`fix/third-party-batch-2`) is open and was red on SDK drift.** Its last
push regenerates the SDK for the `ruleStrong` colour role; confirm that round is
green, then merge. It carries eight third-party fixes including the WCAG 1.4.11
border work across 86 files, so land it before starting anything new.

If it is red again, suspect the same cause twice: adding a colour role changes the
design service's palette **and** patch schemas, and `tests/core/sdk.test.ts`
compares the committed catalog to a fresh generation. Run
`node scripts/generate-sdk.mjs` and commit the diff.

## Context that is not in the code

A third party built two sites on Freeholder, deployed one to DigitalOcean, and
sent three reports: 17 application findings, 8 deployment findings, and one
private security report. **23 of the 24 were reproduced exactly as described**, at
the line numbers given. They are careful reporters — where one of their suggested
fixes was wrong it was wrong for a subtle reason, and their citations were still
accurate a week later.

Their reports are **not in this repository**. They were provided as three files in
the owner's Downloads directory:

- `1-SECURITY-freeholder-forms-get-leak.md`
- `2-freeholder-digitalocean-deployment.md`
- `3-freeholder-findings-17-items.md`

**Ask the owner for them before continuing that work.** The summaries here are
compressed; the originals carry reproduction details this file does not.

The security finding is fixed on `main` (#412). It is **not publicly disclosed**:
the reporter withheld it, the fix landed with a neutral commit message, and
whether to publish an advisory or notify existing instances is an owner decision
not yet made. Every deployed instance with a public form had its notification
addresses readable by any anonymous caller until #412.

## Third-party findings — 13 of 24 fixed

Fixed and merged: locale prefix swallowing `/og` and `/go`; renditions capped one
step below the original; unbounded connection pool; disabled plugin passing
readiness.

Fixed, awaiting #416: manifest naming the platform; missing 404 page; `llms.txt`
country code; 14px controls; `onDanger` unsettable; nav duplicate landmarks and
mobile collapse; `ensureDefaults` 500; the `ruleStrong` border token.

**Still open, in the order I would take them:**

1. **Deployment items (6).** These cost the reporter an evening each. The nightly
   backup cron has **never run once** — `. /opt/freeholder/.env && …` sets shell
   variables without exporting them to a child process, and the failure goes to
   root's mail on a box with no mail server; `BACKUP_BUCKET` is also absent from
   `.env.example`. Then: the App Platform recipe sets `production: false`, a dev
   database whose user cannot `CREATE SCHEMA`, so migration fails on its first
   statement; no CA-certificate support, so pg-boss cannot reach a DigitalOcean
   managed database over TLS while postgres.js can (they read `sslmode=require`
   differently); no bucket CORS step, so the first admin upload fails; `www`
   unserved, the Caddyfile having a single site block; and SMTP documented on 587,
   which DigitalOcean blocks on droplets — note the adapter only uses implicit TLS
   on 465, so Resend's 2465 will not work either.
2. **Media pair.** URLs re-signed every 900 seconds, so a photograph can never be
   cached, a tab open fifteen minutes gets 403s on lazy-loaded images, and image
   search indexes expired URLs; sign against a rounded window instead. Local media
   sends `private, max-age=300` with no `ETag`, `Last-Modified`, `Content-Length`
   or `Range`.
3. **#17, #10, #13.** A form error wipes every field and identifies none; plugin
   blocks cannot declare the heading level they render, so a page whose title
   lives in a hero cannot pass the publish check; `--fh-measure` caps header,
   footer and columns at 48rem.
4. **#8, then #7 and #11 — features, not fixes.** A list row cannot hold an image
   picker because `src/modules/cms/blocks/fields.ts:178` passes `undefined` as the
   hint for every list-item field, so a gallery is edited by pasting UUIDs. #7 is
   media tagging, captioning and search. #11 is plugin folder auto-discovery: §25
   describes it, boot reads a hand-written list in `src/modules/index.ts`, and
   `plugins.install` writes a row nothing loads. **Scope #7 and #11 with the owner
   before building.**

## What I would do next on the plan itself

**C11.10 is the long pole and needs booking, not coding.** An independent security
review needs a third party, lead time and budget.
`security/independent-review-packet.md` exists but is dated 2026-09-12 — since
then a real disclosure was found and fixed and five features' worth of new public
and scoped surface landed. Refreshing that packet would make the review cheaper
and is worth doing while a reviewer is lined up.

**C1.38 and C10.31 are probably finished and merely unticked.** `app/playground/`
and its test exist, the update executor is in `src/core/update/apply.ts`, and
#410's changeset says the playground is live at demo.freeholder.ai. Verify the
evidence and tick them — but *verify*, because C6.11 proved a finished item and an
unfinished one look identical from the checklist.

**Four of the five new items need a demo fixture.** C8.14 has one; C8.15, C8.16,
C5.26 and C6.18 each say "ships no demo fixture of its own", which is their only
F-gap. `src/modules/events/onboarding.ts` plus the three fixture services at the
end of `src/modules/events/service.ts` are the pattern to copy — a known, bounded
job now.

**C6.11's lesson generalises.** Its evidence line cited
`migrations/0059_concerned_sumo.sql`, which the migration squash removed, so the
plan gate would have rejected the tick however complete the software was. A stale
citation and unfinished work are indistinguishable from the checklist. I audited
the other open items and found no second instance, so the remaining fifteen are
genuine — but re-audit after any future squash.

## Release sequencing — decided, not executed

The owner chose: run `changeset version` as its own PR, then tag. Not done.

Facts to carry into it: **369 unconsumed changesets**, and no `v*` tag has ever
existed, so this would be the **first-ever npm publish** of seven packages, none
of which currently exist on npm — name claims are permanent and the unpublish
window is 72 hours. Four changesets declare `major`, all in
`.changeset/apache-license.md`, so the arithmetic lands on **1.0.0**, not 0.2.0.

**Unresolved tension to settle first:** MASTER.md's completion record says
"Unsigned… This is not DONE and does not claim it", with fifteen items open and
C11.17 unsigned, while the version would read 1.0.0. My suggestion was to
reconcile the document — noting that 1.0.0 marks the licence and API boundary
rather than feature completion — rather than the number. **Not agreed.**

Also fix before release: `.changeset/no-live-phone-example.md` has a UTF-8 BOM
before its `---`, which some front-matter parsers skip silently.

## Owner action list

1. **Name the independent reviewer for C11.10.** Longest lead time of anything
   remaining.
2. **Decide the `forms.get` disclosure handling** — advisory, notification to
   known instances, or a quiet fix already shipped.
3. **Decide the release version question** above before `changeset version` runs.
4. **C3.13** live acceptance: a Printify shop + API token, a Shopify store + app,
   a Daily account. Software shipped; credentials entered locally.
5. **C11.08** second Tier-1 restore target, and **C11.11** reference-target
   hardware — the harness now runs, but its numbers must come from the reference
   target, not a development machine.
6. Android/iPad: per the 2026-09-15 decision, physical-device acceptance is v2
   scope (§43.18). **No device setup is needed for v1.**

## Verification environment

This session ran on the owner's Windows machine: Node 24.15.0, PostgreSQL on
**127.0.0.1:5432** with `TEST_DATABASE_URL` pointing at `freeholder_test`. That
differs from the 2026-09-16 handoff, which described a disposable Linux cluster on
port 55432 — that environment is not this machine, and nothing here depends on it.

`pnpm` exists but is not on the Git Bash `PATH` as a bare executable; use `npx`
for local runs, and note that `spawnSync("pnpm", …)` cannot work on Windows at all
(see #415).

Performance budgets, run locally this session and passing on small, medium and
large: `TEST_DATABASE_URL=… PERF_DATASET=small node scripts/performance-budgets.mjs`.

**This machine runs short of memory.** Two background runs were killed by the
harness mid-session; neither was a failure of the command. Prefer CI for
full-suite verification, and verify local sweeps mechanically where you can — for
the 86-file border rename, undoing the rename and comparing byte-for-byte was
stronger evidence than a typecheck would have been.

## Traps this session hit, so you do not

- **Three tests were asserting the wrong thing.** `notify` was tested against
  `forms.byId`, which refuses anonymous callers, while the public `forms.get`
  leaked. A journey test asserted Next's bare `404` heading, holding the missing
  not-found route in place. C6.11's citation kept a finished item open. On this
  codebase a passing test is not by itself evidence the right subject was tested.
- **Route handlers never touch the database** (§15.5). Lint enforces it; the first
  `app/manifest.ts` was refused. Use the request-scoped reads (`currentBusiness`,
  `currentDesign`) and services.
- **The generated SDK and CHANGELOG are both gated against a fresh run.** Any
  service schema change means `node scripts/generate-sdk.mjs`; any changeset means
  `node scripts/generate-changelog.mjs`. Generate the changelog with only
  *tracked* changesets present — an untracked file in the inbox produces output CI
  cannot reproduce.
- **Browser specs seed with inserts, not `service.call`.** `owner-session.ts`
  explains why: `service.call` boots the job graph in a way Playwright's test
  process cannot wire.
- **`tests/core/tokens.test.ts` keeps its own colour-role list** and asserts the
  emitted declaration count against it, so adding a role fails until you add it
  there deliberately. That is the guard working.
- **CI's S3 storage is now our own mirror.** MinIO closed public distribution
  (quay.io and Docker Hub both 401 anonymously; `bitnami/minio` was emptied), so
  `.github/workflows/mirror-ci-images.yml` mirrors `adobe/s3mock` into
  `ghcr.io/campdenman/freeholder-ci-s3`. **Coverage lost:** s3mock accepts any
  credentials, so a SigV4 signing regression would now surface in deployment
  rather than in CI.
- **`ghcr.io` rejects a mixed-case owner** and `github.repository_owner` is
  `CampDenman`; both workflows lower-case it at runtime. `ci.yml` still passes
  `ghcr.io/${{ github.repository }}:edge` as `PREVIOUS_IMAGE` with that mixed
  case, and its login is `continue-on-error`, so the upgrade gate may have been
  silently degraded for some time. **Not investigated.**
- **`tests/core/events.test.ts` times out locally** at the 30s `beforeEach` hook
  (`truncateSpine` plus `updateBusiness`). It passes in CI. If that hook is near
  the limit there too, it is a flake waiting to happen.
- **`git stash` entries exist and predate this session.** Do not pop blindly; one
  is annotated in Git history as already reapplied.

## Known non-blocking issues

- `tests/modules/funnel.test.ts` cross-file isolation flake: intermittent
  exact-count collision on a shared database; passes in isolation, failed
  identically on pre-change trees. Documented in `deploy/f-criteria-matrix.md` and
  `deploy/doc-claim-mapping.md`.
- §4.8's ReleaseNote auto-draft strike (S7 in `deploy/doc-claim-mapping.md`) names
  real follow-up work with **no owning C-item**. Owner decision still needed: add
  a v2 item, or leave it as documented behaviour.
- `plugins/wevibe-industry/` is present in the working tree and untracked. It is
  the owner's industry-starter work and must **not** be committed to this public
  repository; `src/modules/local-plugins.ts` is deliberately an empty array
  because importing it broke the public build and the licence gate.
