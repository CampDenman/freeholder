<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Durable source imports — C3.47 qualification

This is implementation and qualification evidence. `MASTER.md` §43 remains
the delivery authority. C3.22, C3.46 and C3.47 remain unchecked. The local
implementation is unfinished and migration 73 is not journalled: migration 72
must be integrated first. Nothing here authorizes release, deployment or a
stable announcement.

The initial adapter indexes an original WXR file into normalized source entry,
batch and shared media tables. Original private chunks preserve the immutable
source; entries retain byte ranges, SHA-256 identities and bounded metadata.
Every resumed phase verifies its original manifest, generation, frozen plan,
lease and actual current caller. No credential or fabricated worker actor is
stored. The current continuation model is a new authenticated request for each
phase. API key row IDs identify the original key independently of its label.

The ordinary 500-entry / 20 MiB body phase budget stays in place. Complete
graphs have separate hard limits: 10,000 source records, 100 MiB original file,
100 MiB body bytes, 16 MiB entry metadata, 1 MiB header metadata, 4 MiB shared
plan metadata, 500 source files and 500 menu items. Each source range is at
most 32 MiB; the verified chunk cache holds two 4 MiB chunks. One media file is
handled per media phase, up to 25 MiB each and 1 GiB bound original media bytes
in total. Unknown bound allocations still consume that budget.

The global source mapping is reviewed before the first provider or CMS write.
Keep, replace and rename choices advance the reviewed plan revision; old
clients and stale observations cannot emit new batches. Once a plan is
accepted, its source identities, choices, media plan and original source date
are immutable. A restore accepts only the identical original manifest and
verifies one chunk per phase. It changes neither the source generation nor the
original reader-erasure window.

Media has its own normalized identity and accepted receipt. Asset creation,
the import receipt and the shared mapping commit in the same transaction.
Content batches read that mapping rather than copying another batch's asset
ownership. The final navigation batch uses all accepted target mappings.
Reverse processing removes navigation, then page batches, then now-unused
owned media. Ordinary media/CMS permissions and the original audit actor stay
in force. Root import lists and public DTOs hide private batches and staging
authority; source and file review windows each contain at most 50 records.
Prepared content batches temporarily hold their bounded preview. On acceptance
or rollback that preview becomes a minimal receipt marker; source bodies and
author details are not retained as a second accepted body cache. Pending
replacement comments keep their existing privacy-controlled cutover checkpoint.

## Recorded local evidence

- A real 501-page source completed bounded indexing, draft creation,
  reconciliation, publication of all 501 pages and complete rollback in
  49.72 seconds. A later three-case run included two independent Node processes
  in that entire lifecycle plus observed-version and immutable-plan controls;
  all three passed in 149.92 seconds.
- Independent indexing processes preserved the original 500+1 byte ranges and
  source identities without sharing parser memory. Earlier combined graph,
  ordinary WordPress upload and parser qualification passed 57 cases.
- Identical-source restore after 500 accepted pages, a two-chunk restore,
  changed-source refusal, concurrent restore refusal and a late restore result
  after cancellation passed two cases in 21.87 seconds.
- The first shared-media lifecycle passed in 93.38 seconds: an Asset reply was
  deliberately lost after commit, then recovered without another download or
  Asset. Two content batches shared one asset across 501 pages, a nested menu
  activated at publication, reconciliation matched, and reversal restored the
  original navigation and trashed the unused owned asset.
- The next four-case boundary run passed the 500-file cap, total media-byte
  reservations and global keep/replace/rename plus original-page restoration.
  Its exact-key case found the key's own asynchronous last-use write racing a
  guarded authority read. The telemetry isolation repair is under separate
  qualification; this run is **three passes and one failure**, not four passes.
  A later five-case run passed all five actual request/telemetry/grant controls
  in 66.12 seconds, without relaxing the fresh authority row locks.
- The current eight-case native run passed seven cases in 198.11 seconds:
  failed-read immediate recovery, inherited ordinary-import scope isolation,
  observed-version review, the complete 501-page lifecycle and paginated URL
  manifest, shared media/menu recovery, real erasure with a late source result,
  and a named legal hold surviving rollback. The eighth case stopped at an
  incorrect test expectation counting the automatic blog index as an imported
  source page. Its expectation is corrected; author/category rollback still
  requires its own completed rerun.
- Current pure WordPress/index/i18n checks passed 99 cases. These overlap earlier
  parser checks and are not an additional combined total. SDK regeneration
  passed eight inventory controls before the latest review/manifest additions;
  it must be repeated for the final contracts.

## Work still required

The expanded media/choice implementation needs its final complete native rerun,
including the real-post ownership rollback control. The four-locale actual
browser journey is written but has not run. Browser qualification, production
build, final SDK generation, populated 72→73
rehearsal and protected checks. Other source adapters must receive the durable
continuation contract; the WXR vertical alone does not complete C3.22.

Core media's physical PUT ownership has three genuine before failures in the
separate primitive lane. A successful physical write followed by a lost Asset
reply does not establish recovery from an unresolved, delayed or ambiguous
physical PUT. Original storage namespace ownership also remains under review.
Neither clocks nor GET-not-found may establish settlement in a replacement
namespace. These are required dependencies, not optional deferrals.

Historical reader-email ownership, complete source-specific cutover and actual
provider/owner acceptance also remain required. Coding-agent review is not the
independent security sign-off in C11.10.
