<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-09-16, completion push

This is a resumption snapshot, not another roadmap. **Read `CLAUDE.md` and
`MASTER.md` first; MASTER is the sole product, architecture and status
authority.** Refresh GitHub and run the plan gate before relying on snapshot
counts or PR states. This file replaces the 2026-09-14 acceptance-setup
snapshot; earlier contents remain available in Git history.

## Outcome and authorization

The 2026-09-15→16 completion push closed every remaining
closable-by-software item. **No closable-by-software work remains.** Version
stays `0.1.0`; this is not DONE and not a release candidate. Plan gate:
**290 unique IDs, 272 checked, 18 open** — the 18 are §43.2's twelve
F-template rows plus exactly six C-items, each blocked on an owner action
below. No completion checkbox was changed for this handoff.

Standing authorization, unchanged from prior handoffs: routine repository
work (branches, PRs, merges, gates, docs) proceeds autonomously; account
passwords, API tokens and device passcodes are entered locally by the owner
only, never in chat, commits or test artifacts.

## Merged in the completion push

- **#381** note/task trash and restore: privacy holds, typed purge, retention
  safeguards. **#382** real queue dispatch measured through the application
  worker (local baseline, not reference-host evidence).
- **#383** the prior release-notes/handoff refresh this file replaces.
- **#384** dependabot react group kept coherent (react-dom included).
  **#385** mobile acceptance deferred to v2 by owner decision 2026-09-15,
  recorded in §43.18 (C10.17/18/25/26/27/28/30 leave the live sequence; the
  plan gate encodes the closed set).
- **#393** Arabic catalog (`locales/ar.json`, all 6,340 strings) with RTL
  admin, storefront and portal; closes C11.12's accessibility matrix.
- **#394** C3.13 software remainder: owner-storage recording import and
  Shopify refund reconciliation.
- **#395** trash and restore for pages, forms, popups, segments and saved
  views; closes C11.14 (trash-every-row).
- **#396** F01–F12 evidence matrix (`deploy/f-criteria-matrix.md`, 286 rows)
  enforced by `scripts/f-matrix.mjs` plus a gate test; closes C0.11 and
  C11.09.
- **#397** §§1–42 claim→evidence mapping (`deploy/doc-claim-mapping.md`, 118
  claims: 108 evidenced, 10 struck/narrowed in the spec itself) with a
  fail-closed gate test; closes C11.15.
- Dependabot #373–#380 and #83 merged. #109 (TypeScript major) closed: the
  TS major is a deliberate manual upgrade, not a bot bump.

## The six open C-items

The twelve F rows are §43.2's permanent per-item templates, not work. The six
C-items, each blocked on the owner:

- **C3.13** — live Printify/Shopify/Daily acceptance (software shipped in
  #362–#364 and #394); needs the owner's live provider accounts.
- **C11.08** — restore on a second Tier-1 target; needs the owner's Replit
  or DigitalOcean connection.
- **C11.10** — independent security review; needs a named reviewer.
- **C11.11** — reference-target 1 vCPU/1 GB performance; needs doctl auth and
  a droplet.
- **C11.16** — structurally last: auto-unblocks once C3.13 checks, then
  refresh `deploy/spec-reconciliation.md`.
- **C11.17** — owner signature after a clean-room run with zero unexplained
  failures.

## Owner action list

1. Run `~/.local/bin/doctl auth init --context freeholder` at a local
   terminal (token typed at the prompt, never shared). Then existing
   DigitalOcean resources and SSH keys can be inspected before picking or
   creating the C11.11 droplet and the C11.08 second target.
2. Replit (C11.08): add `~/.ssh/freeholder_replit.pub` in the workspace's
   SSH → Keys panel and send the workspace's SSH connect command. Keys are
   account-associated; only the public half goes to Replit.
3. Live provider accounts for C3.13 acceptance: a Printify shop + API token,
   a Shopify store + app, and a Daily account. Credentials entered locally.
4. Name the independent reviewer for C11.10.
5. Android/iPad: per the 2026-09-15 decision, physical-device acceptance is
   v2 scope (§43.18) — **no wipe or device setup is needed for v1.** Platform
   tools remain in `~/.local/share/freeholder-tools` if v2 resumes.

## Verification environment

Node 22.23.2; pnpm 11.1.3. Disposable PostgreSQL listens on
**127.0.0.1:55432**, data under `/tmp/freeholder-audit-pg`, trust auth on
localhost, leave the original database on 5432 alone. Browser server uses
port 3100; Chromium is installed. If the cluster is gone:

```sh
PGBIN=/tmp/pg-bin/postgresql-16.6.0-x86_64-unknown-linux-gnu/bin
$PGBIN/initdb -D /tmp/freeholder-audit-pg -U postgres -A trust
$PGBIN/pg_ctl -D /tmp/freeholder-audit-pg -l /tmp/freeholder-audit-pg.log \
  -o '-p 55432 -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off' start
```

(Re-fetch the same upstream PostgreSQL 16.6 build if /tmp was cleared.)

Full-suite verification for #396/#397 ran on fresh disposable databases:
**3,655–3,657 tests passing, 17 skips** — all inapplicable deploy-recipe
cases in `tests/core/deploy-recipe.test.ts`, documented in the headers of
`deploy/f-criteria-matrix.md` and `deploy/doc-claim-mapping.md`. Gates green:
`pnpm plan:check` 290/272/18; `pnpm gates` (types, lint, license, plan,
changelog, f-matrix, doc-claim-mapping).

From a worktree at origin/main:

```sh
pnpm install --frozen-lockfile --offline
pnpm gates && pnpm plan:check
CI=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/<fresh-db> pnpm test
```

Browser tests need a current production build first; use a local test-only
`SESSION_SECRET`. Never run build and gates concurrently (`.next` type
generation) or suites sharing a database concurrently (fixtures truncate).
`/tmp` logs may disappear on reboot.

## Known non-blocking issues

- `tests/modules/funnel.test.ts` cross-file isolation flake: intermittent
  exact-count collision on the shared disposable database; 8/8 passing in
  isolation, failed identically on pre-change trees. Documented in both
  mapping docs, per the audit's report-don't-silently-fix rule.
- §4.8's ReleaseNote auto-draft strike (S7 in `deploy/doc-claim-mapping.md`)
  names real follow-up work — module/plugin/setting auto-drafts, the
  agent-note service rule and the admin timeline — with **no owning C-item**.
  Owner decision needed: add a v2 item or leave as documented behaviour.
- Local repo hygiene is done: stale worktrees and branches pruned. The stash
  `Note/task recovery work before integrating reviewed parent changes` is
  retained untouched — its contents were already reapplied; **do not pop it
  again**.

## Resuming

The resume path is the owner action list, in any order the owner can
satisfy. C3.13 unblocks C11.16; C11.17 is the signature after a clean-room
run. The owner has not supplied provider accounts, a second target, a
reviewer, or a signature; do not infer any of these from broad
implementation permissions.
