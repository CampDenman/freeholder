<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Freeholder restart handoff — 2026-09-05

**Historical snapshot only. Not a planning authority.** `MASTER.md` §43 is the
only product, architecture, status, and delivery source of truth. Do not pick
the next work item from this file. In-flight PR tables here are frozen at
write time; live GitHub state wins.

## Executive outcome

This sprint removed the highest-risk known provider waits from service-owned
database transactions, cleaned one stale export PR, began repairing the stale
dependency queue, and found a nondeterministic cryptography test in the merge
queue.

Landed on `main`:

- **#269** replaced dirty export PR #244 with a clean, audited export boundary.
  Actual merge commit: `19372669ea1cb631b0d287ec455a3bddaebdb96d`.
- **#206** upgraded Vitest from 4.1.10 to 4.1.11 after a fresh rebase and full
  PR plus merge-group CI. Actual merge commit:
  `24c48079fccde4444917a84298a2475ce15b1fcf`.
- **#270** introduced explicit transaction-free orchestration and moved the
  OAuth/signup-provider workflows onto it. Actual merge commit:
  `62d7b73cdf653aa421b110812339011c8c5a0cc6`.

The plan gate at the last local run reported **282 unique IDs, 222 checked, 60
open**. Run `npm run plan:check` for the live count.

## Exact local state

- Repository: `C:\Users\tony\code\freeholder`
- Remote: `https://github.com/CampDenman/freeholder.git`
- Current root branch: `fix/media-alt-text-transaction-boundary`
- Current implementation commit before this documentation follow-up:
  `e3edf3822e362611d2e2489cac1f05c98c0fe968`
- Current root PR: **#273**
- Temporary worktree: `C:\tmp\freeholder-eslint-clean`
- The temporary worktree is currently on `fix/mail-outbox-tamper-test`, the
  branch for **#272**. Its earlier `chore/eslint-10-9-1-clean` commit is already
  pushed for **#271**; switching the worktree did not alter that remote branch.

Do not remove the temporary worktree while a process is using it. Once #271
and #272 are merged, it can be removed with `git worktree remove` after first
checking `git status` in both worktrees.

## In-flight PRs and required order

GitHub state changes while this file is read. Refresh each row with
`gh pr view <number> --json state,mergedAt,mergeCommit,headRefOid,baseRefOid,mergeStateStatus,statusCheckRollup`.

| Order | PR | Purpose | State at handoff |
|---|---:|---|---|
| 1 | #272 | Make the mail-outbox tamper test deterministic | Fresh PR CI running |
| 2 | #271 | Clean ESLint 10.9.1 replacement for dirty #205 | Rebased onto #270; fresh PR CI running |
| 3 | #273 | Release the media DB transaction before preview/AI alt-text work | Documentation follow-up is on the branch; refresh the restarted PR CI |

Land them in that order through the merge queue. For each PR:

1. Wait for every fresh PR check, including all 20 shards, browser,
   image/recipes/upgrade, security, backup, CodeQL, DCO, and aggregate
   `checks`.
2. Run `gh pr merge <number> --merge`. GitHub will say that `main` uses the
   merge queue; that is expected.
3. Find the new merge-group run with
   `gh run list --event merge_group --limit 5`.
4. Wait for that run, then verify `state: MERGED` and a non-null `mergedAt` on
   the PR. A green PR or a queue command is not evidence that it merged.

Do not queue #271 before #272 is actually merged. Do not queue #273 before
#271 is actually merged. Rebase/update a later PR only if GitHub reports a
real conflict or its current evidence is invalidated; the merge queue itself
tests the exact integration commit.

## Dirty PR #205 and its clean replacement

PR **#205** is the stale Dependabot ESLint update. Its automatic rebase onto
main produced malformed YAML:

- original pre-rebase head:
  `f53456686aa48f7a5cbb11cb98fd67e9ce7e5b5b`
- malformed rebased head:
  `ac97c357293a8ea9c860a0ed47b9ae746e2bafda`
- failure: duplicate `picomatch@4.0.7` package and snapshot mapping keys in
  `pnpm-lock.yaml`; every CI job failed during `pnpm install --frozen-lockfile`
  before tests could run.

Clean replacement **#271** was regenerated from current `main`, passed a
frozen install, dependency audit, typecheck, lint, and its first complete PR
CI, then was rebased onto #270 to obtain fresh evidence. A provenance comment
is on #205:
`https://github.com/CampDenman/freeholder/pull/205#issuecomment-5554869419`.

**Leave #205 open until #271 is actually merged.** Then add a final comment
linking the replacement merge commit and close #205 as superseded. This is the
same rule used for export PR #244: replacement code must be on `main` before a
dirty original is closed.

## Remaining safe dependency queue

After #271 is actually merged and #205 is closed, advance exactly one safe PR
at a time:

1. **#204** — `@types/react-dom` 19.2.3 → 19.2.5
2. **#202** — Nodemailer 9.0.3 → 9.1.1
3. **#108** — `typescript-eslint` 8.65.0 → 8.67.0
4. **#87** — `@types/node` 26.1.1 → 26.4.1

For each: rebase with `gh pr update-branch <n> --rebase`, record the new head,
wait for the complete fresh PR matrix, queue it, and verify the actual merge
before touching the next one. A rebase can mechanically corrupt a lockfile, as
#205 proved; always inspect the dependency diff and frozen-install log.

Do not blindly merge these deliberate compatibility changes:

- **#203 Next 16.3.4.** Current head
  `de5cc9237c2df3cd1990766550c0126130fde7cc` fails application, browser, and
  image builds because Turbopack tries to hash the Sharp platform package
  `@img/sharp-libvips-linux-x64` as a file and receives `EISDIR` / `os error
  21`. Its separate unit-shard failure was a statement-timeout/flaky truncate.
  Treat this as dedicated Next/Sharp compatibility work.
- **#201 @changesets/cli 3.0.1.** Major release-tooling change; review release
  automation and generated notes before updating.
- **#109 TypeScript 6.0.3.** Major compiler change; validate with the final
  typescript-eslint combination rather than in isolation.
- **#83 @types/jsdom 30.0.0.** Major ambient-type change; review together with
  the runtime/testing stack.

## Transaction-boundary architecture now on main

`src/core/service.ts` now exports `defineOrchestratedService`.

Use it only for a public synchronous workflow that must cross a slow provider
boundary:

- It runs the public handler with **no database transaction open**.
- It uses the same permission, human/agent, step-up, input, rate-limit, and
  output gates as an ordinary service.
- It refuses `options.tx`, so `ctx.call` cannot accidentally move provider I/O
  back underneath another service transaction.
- Every database mutation remains a short ordinary `defineService` phase and
  therefore retains atomic writes, caller authorization, audit records, and
  post-commit event dispatch.
- Private caller-authorized phases declare `external: false`. They retain the
  original caller identity but are omitted from HTTP, OpenAPI, and MCP.
- Add every `external: false` phase to the exact inventory in
  `tests/core/internal-services.test.ts`.
- Register every phase in its module service array. An unregistered phase is
  not a structural boundary.

Do not use `permission: "system"` merely to hide a phase. That would erase the
caller authorization property. Do not call `db()` from a transactional service
to obtain a second connection. Do not pass public OAuth `code`, raw state, or
credentials through an audit-visible field; the new phase inputs deliberately
use redacted key names such as `stateToken`, `credentials`, and `response`.

The structural guard is
`tests/core/long-running-service-boundary.test.ts`. It follows local helpers
reachable from `defineService` handlers and rejects known provider methods and
functions there. Extend its reviewed provider-name set whenever a new adapter
operation is introduced.

## Provider workflows completed in #270

All five OAuth completion paths now follow claim → provider → apply:

- `mail.completeOAuth`
- `connections.completeCalendarOAuth`
- `connections.completeMailReadOAuth`
- `signupContactImports.completeOAuth`
- `social.completeOAuth`

The one-time state claim commits before the single-use provider code is spent.
A failed provider exchange therefore leaves the state consumed, preserving
the prior replay semantics without holding one pool connection while asking
for another. The provider exchange and identity lookup run outside every DB
transaction; a new short phase atomically stores the validated credentials,
capabilities, senders, or profile.

Signup provider contact list/stage flows were also split:

- a private source query verifies the portal customer, current policy,
  start eligibility, account ownership, provider, capability, allowed fields,
  and limit;
- token refresh and provider paging happen with no service transaction open;
- staging revalidates customer, policy, account/provider identity, and the
  current maximum before writing the selected rows.

Public service names and input/output shapes are unchanged. The changeset
`provider-workflows-without-open-transactions.md` is the owner-facing release
note and has been rewritten for clarity in the #273 documentation follow-up.

## Media alt-text follow-up in #273

PR #273 applies the same boundary to `media.generateAltTextSuggestion`:

- private source query verifies a ready, non-trashed image and snapshots its
  storage key, MIME type, variants, checksum, and authored alt text;
- preview reads and `provider.suggest()` run outside a transaction;
- private apply mutation locks the current asset and compares source identity
  plus authored text before superseding/storing suggestions;
- a concurrent image or alt-text edit wins and produces a safe conflict rather
  than being overwritten;
- the public human-only service name, hourly rate limit, output, review flow,
  audit, and event behavior remain intact.

Local evidence for #273:

- `npm run typecheck` — passed
- `npm run lint` — passed
- media/projection/boundary suite — 4 files, 48 tests passed
- changelog gate — passed
- schema compatibility gate — no migrations changed
- `git diff --check` — passed

Release note: `.changeset/generate-alt-text-without-open-transactions.md`.

## Remaining long-running media transactions

Do these as bounded, separately reviewable PRs. `src/core/media/service.ts` is
large and several flows need failure semantics, not a mechanical wrapper.

Highest priority:

1. **Direct/proxy upload lifecycle:** `uploadAsset`, `beginUpload`,
   `uploadStatus`, `signUploadParts`, `completeUpload`,
   `registerStoredOriginal`, and `abortUpload` currently mix storage,
   multipart-provider, scanning/rendition, and DB work inside service
   transactions. Preserve the invariant from the file header: an object with
   no row is recoverable litter; a row pointing to a missing object is a broken
   customer asset.
2. **Rescan:** `media.rescan` reads storage, calls the malware scanner, builds
   renditions, and writes storage inside its transaction. Use a source snapshot
   and apply-time comparison like alt text. Track newly written objects so a
   losing apply can leave only sweepable orphans, never attach stale variants.
3. **Watermark backfill:** `media.backfillWatermarks` performs a batch of
   storage reads, image processing, storage writes, and row updates in one
   transaction. Prefer one durable unit per asset with short claim/apply phases
   rather than moving the whole batch into one orchestrator.
4. **Permanent purge:** `media.purge` and `media.purgeExpired` delete external
   objects before deleting the DB row. A storage success followed by DB rollback
   leaves a visible row whose bytes are gone. Design this around durable cleanup
   or DB-first invisibility plus orphan sweeping; do not merely move the same
   calls around. Preserve owner confirmation and the 30-day trash window.
5. **Resolution queries:** `resolveImage` and `resolveAsset` await storage URL
   generation inside query transactions. Determine whether each configured
   adapter performs network I/O before changing them; do not assume every
   async method is slow.

Also inspect scheduled cleanup helpers near the end of the media service. They
are not necessarily service-owned transactions, but the same external/DB
partial-failure rules apply.

## Merge-queue failure that must not be forgotten

PR #270 passed its entire PR matrix. Its merge-group run **33993046449** then
failed `Tests (19/20)` at `tests/core/mail-outbox-crypto.test.ts:60`, yet GitHub
still reports #270 merged at `2026-09-05T21:34:13Z` with merge commit
`62d7b73cdf653aa421b110812339011c8c5a0cc6`.

Root cause of the test failure: the test changed only the final Base64URL
character. When that character contains unused padding bits, two characters
can decode to identical ciphertext, so authenticated decryption correctly did
not throw. PR #272 flips a decoded ciphertext byte and re-encodes it, making
the tamper real and deterministic.

Separate from the test fix, audit the GitHub ruleset/required-check mapping:
the merge-group workflow concluded `failure`, aggregate `checks` was skipped,
and the PR nevertheless merged. Do not assume branch protection is enforcing
the intended aggregate until that configuration is explained and tested. No
repository ruleset was changed in this sprint.

## Validation and local-process lessons

The #270 focused suite passed 10 files / 89 tests. A second focused run initially
showed foreign-key and duplicate-key errors because the interrupted session
had left an older Vitest process running against the same test database. After
stopping only those orphaned Freeholder processes, the isolated suite passed.

`fileParallelism: false` protects files within one Vitest process; it cannot
protect one process from a second process using the same database. Before a
database suite, check for orphaned commands with a read-only process query and
never run two Freeholder Vitest processes against the same `TEST_DATABASE_URL`.

Avoid running multiple full ESLint/typecheck processes simultaneously on this
machine. They remained correct but starved each other and took several times
longer. Run the database suite serially and the CPU-heavy gates sequentially.

## Release notes updated here

Freeholder assembles release notes from `.changeset/*.md`; there is no manually
maintained root `CHANGELOG.md`. This handoff update refreshes the two notes for
the transaction work:

- `.changeset/provider-workflows-without-open-transactions.md`
- `.changeset/generate-alt-text-without-open-transactions.md`

Both are written for an owner: they explain the reliability/concurrency effect
and preserved behavior without exposing internal implementation as the headline.
Do not add a changeset for #272 because it changes only a flaky test.

## Immediate restart checklist

1. Read `CLAUDE.md`, then run `git status` in both worktrees.
2. Refresh PRs #272, #271, and #273 from GitHub; this file is only a snapshot.
3. Push the release-note/handoff follow-up on #273 if it is still local.
4. Land #272 through the merge queue and verify the actual merge.
5. Land #271, verify the actual merge, then close dirty #205 with provenance.
6. Land #273 after rebasing/updating only as needed and obtaining fresh CI.
7. Audit why failed merge-group run 33993046449 did not prevent #270 merging.
8. Advance safe dependency PR #204, then #202, #108, and #87 one at a time.
9. Start the next media transaction PR with `media.rescan` or the upload
   lifecycle; do not combine every media flow into one review.

The next sprint should optimize for proven invariants, not PR count. A queue
command, a green stale check, and an apparently harmless lockfile rebase have
all been shown insufficient in this exact repository; verify the artifact and
the actual merge each time.
