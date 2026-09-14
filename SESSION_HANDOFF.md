<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-09-14

**Historical snapshot only. Not a planning authority.** `MASTER.md` §43 is the
only product, architecture, status, and delivery source of truth. Do not pick
the next work item from this file. Live GitHub and `pnpm plan:check` win over
every table below.

This session ended because the operator was about to hit a usage limit. Work
stopped after #359 landed on `main`.

## Scoreboard

At `c496198` (`main` after #359):

| | |
|---|---|
| Plan gate | **297 unique IDs, 270 checked, 27 open** (`pnpm plan:check`) |
| Product version | `0.1.0` — active development, not a release candidate |
| Remote | `https://github.com/CampDenman/freeholder.git` |
| GitHub login used | `domainersuite` (Tony Aly), admin on `CampDenman/freeholder` |
| Clone | `/home/tony/code/freeholder` (not `/freeholder`; that path needs sudo) |
| `gh` | `~/.local/bin/gh` v2.100.0 |
| Graphite | not installed — plain-git + GitHub merge queue |
| Deploy from this login | GHCR **Publish image** after green main-push CI. No DigitalOcean droplet (`doctl` not authenticated). |

## What landed on `main` this session

Each of these waited for required checks (including browser journeys) then
went through the **main merge queue** (squash). Main-push CI then built the
attested candidate; **Publish image** promoted successful runs to GHCR.

### CI unblock

- **#357** Recipe-gate MinIO from Quay (`quay.io/minio/minio`), same digest.
  Docker Hub had started denying `minio/minio`. This unblocked every PR.

### Honesty and C11 journeys / quality

- **#334** Reopen C3.13; live Stripe/PayPal stays C11.05.
- **#335** Reviews, OAuth begin, quote convert, AdminNav holes.
- **#347** C11.01–C11.08 journeys.
- **#348** C11.09 F-matrix / F04 callers.
- **#349** C11.15 remainder, record participation, a11y.
- **#350** Security packet, perf harness, C11.13 failure drills, import rollback.
- **#351** C11.16 spec recon. C11.17 record prepared, **unsigned**.
- **#352** Closed as superseded (CI-green fixes already on main).
- **#354** Unique F05 stamps. C11.09 and C0.11 checked.
- **#355** `search.query` + `/admin/search`. C11.14 stays `[ ]`.
- **#356** Closed as superseded (Segmented contrast already in #349).
- **#358** Per-kind retention policies + `core.applyRetention`. C11.14 stays `[ ]`.
- **#359** Ten extra F04 list screens in the axe loop. C11.12 stays `[ ]`.

### Mobile

- **#336** Native galleries (cache-import from #353 folded in).
- **#341** Customer reply, newsletters, account, native 2FA.
- **#343** Owner companion.
- **#345** Offline capture batches.
- **#342** `npx freeholder-app init` — **C10.15 checked**.
- **#344** Store contract, privacy manifests, EAS CI — **C10.16 checked**.
- **#346** Reviewed schema baseline — **C10.19 checked**. Migrations after this
  are `0001+` on top of `0000_reviewed-baseline.sql`.

### C3.13 first-party plugins (code on main, box still `[ ]`)

- **#337** Community rooms/posts/feed/moderation — `0001_community_rooms.sql`
- **#338** Voice-video rooms/recordings/transcripts — `0002_voice_video_rooms.sql`
- **#339** Print-on-demand catalog fulfillment — `0003_print_on_demand_fulfillment.sql`
- **#340** Marketplace channel sync onto invoices — `0004_marketplace_channel_sync.sql`

C3.13 stays open: POD and marketplace adapters are **fixtures**, not live
Printify or channel APIs.

## Open GitHub PRs (leave parked)

- **#109** Dependabot TypeScript 6 — do not merge
- **#83** Dependabot `@types/jsdom` — do not merge

No product PRs were left open.

## Still `[ ]` — cannot fake from this machine

- **C11.17** Tony Aly signs the §43.1 control block after a clean-room run
- **C11.10** Independent security review (packet exists; review does not)
- **C11.05** Live Stripe/PayPal settlement
- **C11.08** Second live Tier-1 restore (ownership-drill is not that)
- **C11.11** Medium/large seed + Core Web Vitals on the $6 droplet
- **C10.17, C10.18, C10.25–C10.28, C10.30** Physical-device a11y / keychain / OS background

## Still `[ ]` — named leftovers in the tree

- **C3.13** Live Printify / live marketplace provider I/O
- **C11.12** RTL catalog (injected `dir`, not `locales/ar.json`); remaining F04
  lists not in axe (inbox, invoices, orders, galleries, quotes, forms, media,
  jobs, locations, calendar, automations, reports, newsletters, appointments,
  documents, events, projects, tasks, segments, reviews, social, subscriptions)
- **C11.14** No undelete-every-row; orders/subscriptions stay per-list search
- **C11.15** Not every §§1–42 sentence has its own acceptance test

## How to resume

1. `git fetch origin main && git checkout main && git pull`
2. `pnpm plan:check` — live checkbox count
3. `MASTER.md` §43.1 control block — current focus and remaining open
4. Owner-facing notes: `CHANGELOG.md` (generated from `.changeset/`)
5. Session digest: `deploy/release-notes-2026-09-14.md`

Next buildable slices if you continue in code (do not check the parent C-item
until the leftover named in MASTER is gone):

1. More F04 list screens in `tests/browser/accessibility.spec.ts`
2. Orders/subscriptions as `search.query` sources if they grow a title/number
3. Live Printify / marketplace adapters behind `defineOrchestratedService`
4. Nothing that forges C11.17, independent C11.10, live money, or device proof

## Conventions that bit this session

- Merge queue on `main` (squash, ~5 min grouping). Do not `--delete-branch`.
  `gh pr merge N --auto` after checks; wait for merge-group CI.
- Additive SQL after the baseline is `0005_…` next (`0000`–`0005` are taken).
  Identity proof applies **only** `0000_reviewed-baseline.sql`.
- New contact-FK tables must be a `search.query` source **or**
  `SEARCH_TABLE_OPT_OUTS`, and a retention source **or**
  `RETENTION_TABLE_OPT_OUTS`.
- After a changeset: `node scripts/generate-changelog.mjs` or
  `changelog-output.test.ts` fails.
- `contacts.resolve` not `contacts.create`. `ctx.call` from handlers.
- Root `tsconfig.json` excludes `apps/` — tests must not import Expo sources.
- DCO: `git commit -s` as Tony Aly /
  `16022426+domainersuite@users.noreply.github.com`.

## Local worktrees (safe to delete after this wrap)

Under `/home/tony/.grok/worktrees/db6b123f-*` and `/tmp/fh-wrap`. They are not
`main`. Object store: `/home/tony/code/freeholder`.
