<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Session handoff — 2026-09-14, acceptance setup

This is a resumption snapshot, not another roadmap. **Read `CLAUDE.md` and
`MASTER.md` first; MASTER is the sole product, architecture and status authority.**
Refresh GitHub and run the plan gate before relying on snapshot counts or PR
states. Earlier contents of this file remain available in Git history.

## Outcome and authorization

The owner wants Freeholder finished, with minimal approval interruptions. The
latest request is to update release notes and leave this handoff. The owner
has also offered their Replit and DigitalOcean accounts, a test Android and an
iPad, and explicitly authorized wiping those two test devices and starting
fresh. Account connections and device identity are still missing; no device
has been wiped. Identify the actual model/serial before any reset. Enter
account passwords, API tokens and device passcodes locally, never in chat,
commits or test artifacts. The independent reviewer has not been identified.

Main was fast-forwarded locally to **`55d65fc`**, after #372. Version remains
`0.1.0`; this is not Done or a release candidate. Plan gate: **297 unique IDs,
267 checked, 30 open**, including **255/273 checked C-items and 18 open**.
No completion checkbox was changed during this handoff.

## Merged work since the earlier handoff

- #361: audit repairs and corrected evidence; see
  `security/project-audit-2026-09-13.md` and `MASTER.md`.
- #362–#364: Printify fulfillment, Shopify verified paid-order import, Daily
  private rooms and verified recording access. Live-provider acceptance remains.
- #365, #367, #368: catalog/order permissions, cart/private-wishlist capabilities,
  and hidden location protection.
- #366, #369, #371: broader grant-filtered search, including exact record
  destinations, localized labels and view-only browser journeys.
- #370 (`8669061`): durable Daily erasure; privacy requests stay in progress
  until provider jobs acknowledge completion. Preserve original job IDs across
  dead-letter redrive. See `deploy/provider-recording-erasure.md`.
- #372 (`55d65fc`): private-note pin/history access control and edit/remove locks.
- #369 also repaired booking tests whose fixed dates had become past dates.
  `tests/helpers/booking-time.ts` supplies future dates for live-clock tests;
  pure policy tests with explicit clocks retain their fixed dates.

## Open product PRs at write time

| PR | Worktree / branch | Head | State to resolve |
|---|---|---|---|
| [#381](https://github.com/CampDenman/freeholder/pull/381) | `/home/tony/code/freeholder-record-recovery`, `feat/note-task-recovery` | `1c1d504` | Open; GitHub reports merge conflict after parent squash merges. |
| [#382](https://github.com/CampDenman/freeholder/pull/382) | `/home/tony/code/freeholder-queue-performance`, `test/queue-performance` | `3c84ce4` | Open; contains #381. Security/dependency evidence and its aggregate check failed. |

Automatic merge was enabled, but that is not proof of merge. #382 run
`34877373369`, job `104088358090`, completed dependency review without vulnerable
packages and then failed TruffleHog with **zero verified and one unverified
secret finding**, exit 183. The finding has not been classified. Inspect it
without printing candidate secrets; fix its cause and rerun the check. Do not
bypass or weaken the scanner. Local log: `/tmp/freeholder-handoff-security-check.log`.

For #381, merge current `origin/main` into its branch and resolve generated
locales/changelog carefully. Preserve provider-erasure, workflow-search and
private-note changes. Then propagate the resolved #381 branch into #382.
Regenerate `CHANGELOG.md`, verify the merged tree, push and re-enable automatic
merge if needed. Use the protected queue and verify the resulting main commit.
Do not delete branches/worktrees. Dependency PRs #373–#380 and older #109/#83
were not part of this work; refresh and review them separately.

## Recovery implementation and evidence (#381)

Notes/tasks gain nullable trash timestamps via additive migration
`0010_note_task_trash.sql`, restore/purge services, paginated trash listing,
localized UI, SDK methods and a daily 500-per-kind purge of eligible thirty-day
trash. Existing read/manage grants and private-note visibility apply. Manual
purge requires typed `PURGE` and recent identity verification. Privacy holds
protect both purge paths; privacy erasure still removes personal data.

Normal lists, search, reminders, briefings and project checklists/counts exclude
trash. Contact merge and undo repoint contact-subject links as well as contact
IDs. Task page, navigation and saved views use task access, not a CRM grant.
Other record families still lack undelete; C11.14 remains open. Read
`deploy/record-trash.md` in the PR for rollback and retention-policy limits.

Validated locally:

- Full fast gates: 300 contracts pass, one intentional database skip; types,
  lint, license, release notes and plan gates pass.
- Eight new recovery cases cover visibility, holds, erasure, merge and undo,
  bounded purge/pagination, manage permissions and identity verification.
- Project/recovery integration: 22 tests pass; saved views: 20 tests pass.
- SDK generation: eight database-backed tests pass.
- Production build and standalone artifact inspection pass.
- Two final Chromium journeys pass, including keyboard operations/navigation,
  view-only staff, private-note exclusion, and twelve axe/reflow combinations:
  en/fr/es × light/dark × desktop/320px. This is not the entire C11.12 matrix.

CI initially found project queries still exposing trashed tasks. Fix `11af80f`
filters both checklist reads and counts; `1c1d504` fixes task navigation/views.
Keep the extended project and browser regressions when resolving conflicts.
Logs include `/tmp/freeholder-recovery-project-tests.log`,
`/tmp/freeholder-recovery-views-tests.log`,
`/tmp/freeholder-recovery-final-build.log`,
`/tmp/freeholder-recovery-final-browser.log`, and
`/tmp/freeholder-recovery-navigation-contracts.log`.

## Performance implementation and evidence (#382)

`PERF_MEASURE_JOBS=1` now measures twenty sequential transactional enqueues
through the real application worker. Database creation/start timestamps yield
p95; every probe must execute and complete. Small and medium CLI runs each
pass ten tests, with queue p95 1,985 and 1,982 ms respectively. Large fixture
plus requested queue clocks deliberately fails with a missing measurement.
Fast gates pass. A combined parent-state run passed 42 tests across recovery,
projects, deferred erasure, performance and CI shard-budget checks.

These are local baseline dispatch measurements, not throughput/backlog or
reference-target results. The disposable local database uses settings intended
for functional tests. Browser/editor, migration and cold-boot clocks and the
actual 1-vCPU/1-GB run remain open. See `deploy/performance-measurements.md` in
#382 and `/tmp/freeholder-queue-perf-{small,medium,large-refusal,gates}.log`.

## Account and device setup

Local setup is outside the repository:

- `~/.local/bin/doctl`: version 1.168.0, downloaded from the official GitHub
  release and checked against its published SHA-256. `doctl account get` reports
  that an access token is required. The default auth context is not authenticated.
- Owner should run `~/.local/bin/doctl auth init --context freeholder`, entering
  the token directly at the terminal prompt. Then inspect existing resources
  and SSH keys before selecting or creating the acceptance target.
- A dedicated Replit SSH keypair exists at `~/.ssh/freeholder_replit`; its public
  key is `~/.ssh/freeholder_replit.pub`. Private key permissions are 0600. Only
  the public key should be added in Replit's SSH → Keys panel. The owner still
  needs to supply the workspace's SSH connection command. No Replit connection
  or deployment has been made. SSH keys are account-associated in Replit.
- Android platform tools 37.0.1 are in
  `~/.local/share/freeholder-tools/platform-tools`, with `adb`/`fastboot` links
  in `~/.local/bin`. `adb` was started; `adb devices -l` showed no devices.
- USB inventory showed neither the Android test device nor the iPad. The owner
  needs to connect and unlock them. Android USB debugging and host authorization
  will be needed for ADB access. iPad passcode/Apple Account prompts may require
  local interaction during reset. No Apple device tooling was installed.
- Device erase is authorized for these test devices, but no serial/model has
  been identified. Do not issue an untargeted wipe or unlock a bootloader merely
  to obtain test access. Native iPad build/install tooling and signing still
  need assessment after connection; Linux alone is not evidence of iOS testing.

References: [DigitalOcean setup](https://docs.digitalocean.com/reference/doctl/how-to/install/),
[Replit SSH](https://docs.replit.com/features/workspace-tools/ssh),
[Android platform tools](https://developer.android.com/tools/releases/platform-tools),
[Apple reset instructions](https://support.apple.com/en-gb/108931).

## Local verification environment

Node 22.23.2; pnpm 11.1.3. Disposable PostgreSQL listens on **127.0.0.1:55432**,
with data under `/tmp/freeholder-audit-pg`. Leave the original database on
port 5432 alone. Relevant disposable databases:

- `freeholder_recovery_test`: recovery/project/privacy/service tests, schema 0010.
- `freeholder_recovery_browser_test`: browser fixtures, schema 0010.
- `freeholder_queue_performance_test`: performance/integration fixtures, schema 0010.

From the matching feature worktree:

```sh
pnpm install --frozen-lockfile --offline
pnpm gates
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/freeholder_recovery_test pnpm exec vitest run tests/core/record-trash.test.ts tests/core/projects.test.ts tests/core/saved-views.test.ts
BROWSER_DATABASE_URL=postgres://postgres@127.0.0.1:55432/freeholder_recovery_browser_test pnpm exec playwright test tests/browser/record-trash.spec.ts --config playwright.a11y.config.ts
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/freeholder_queue_performance_test PERF_DATASET=medium PERF_MEASURE_JOBS=1 pnpm perf:budgets
```

Browser tests require a current production build first; use a local test-only
`SESSION_SECRET` when building. Never run build and gates concurrently because
of `.next` type generation. Never run suites sharing a database concurrently:
fixtures truncate tables. Chromium is installed; browser server uses port 3100.
No Docker, Podman, authenticated cloud target or physical-device run was
available in this session. CI uses 24 runtime-balanced test shards; retain its
budget checks. Passing fast gates does not replace browser/recipe/upgrade CI.

All product worktrees were committed and clean when the documentation wrap
started. Run `git worktree list` and `git status` before touching them. Retain
the stash named `Note/task recovery work before integrating reviewed parent
changes`: its contents were already reapplied and resolved; **do not pop it
again**. `/tmp` logs and helper scripts are local and may disappear on reboot.

## Remaining completion evidence

The exact open C-items are C0.11, C3.13, C10.17, C10.18, C10.25–C10.28,
C10.30, C11.08–C11.12 and C11.14–C11.17. Read their current MASTER entries.
They cover provider completeness (including owner-storage recording import),
the full F/spec audit, remaining restore participation, full browser/RTL and
physical-device workflows, live cross-target restore, reference-host timings,
independent security review and clean-room/owner signoff. Existing automated
checks and local browser runs are not substitutes for those missing proofs.

Resume with the pending PR blockers and the owner's connection steps above,
then select the next authorized work from MASTER. The owner has not supplied
an independent reviewer or signed the final completion record. Do not infer
that either happened from broad implementation permissions.
