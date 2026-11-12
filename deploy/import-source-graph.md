<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Durable source imports — C3.47 qualification

This is implementation and qualification evidence. `MASTER.md` §43 remains
the delivery authority. C3.22, C3.46 and C3.47 remain unchecked. The local
implementation is under qualification. Migration 73 is journalled immediately
after the merged mail-recovery migration 72; the source branch is based on
`dba1b242`. Nothing here authorizes release, deployment or a stable announcement.

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
  incorrect test expectation counting the already-existing default blog index
  as an imported source page. A composed quiet rerun reached its last assertion
  after correctly reversing all 501 posts, authors and terms, then correctly
  preserved that original default index. The fixture now explicitly removes
  its synthetic default first so it exercises an import-created index; that
  corrected ownership variant and the populated 72→73 admission fixture then
  both passed in 51.24 seconds. That fixture preserves ordinary previews and
  retained manifests and proves the new database trigger rejects unguarded
  old root and child writes; it is not an old application image boot.
- Current pure WordPress/index/i18n checks passed 99 cases. These overlap earlier
  parser checks and are not an additional combined total. SDK regeneration
  passed eight inventory controls before the latest review/manifest additions;
  the composed final contract regeneration subsequently passed all eight in
  3.11 seconds on a fresh database migrated through 73.
- The first composed production build passed with 20,362 files and 243,484,458
  artifact bytes. The standalone scrub reported no source/environment leakage.
  This is preparation for browser qualification, not deployment acceptance.
- The English production-browser journey passed in 59.5 seconds after the
  fixture awaited actual bounded RPC receipts. It covers keyboard pause,
  interrupted request, reload, identical-source restore, a renamed cross-batch
  link, publication and complete reversal of 501 pages, plus both-theme mobile
  accessibility and overflow checks. Spanish, French and Arabic subsequently
  all passed in 3.8 minutes against the same production artifact and schema,
  including Arabic RTL. The browser fixture waits for each real phase receipt
  before inspecting its next control or beginning another locale.
- A real older production artifact from the mail-72 worktree then passed the
  opt-in HTTP writer probe in 4.55 seconds. An ordinary finite import committed;
  graph-root and private-child commit and rollback requests all failed at the
  database's SQLSTATE 55000 guard and preserved their original statuses and all
  CMS pages. This is an older artifact compatibility probe, not a reproducible
  source-attested `dba1b242` image: that worktree's head was `6dabec18`, before
  the held-member fix. The disposable server was stopped and its database had
  no active writers before the shared PostgreSQL slot was returned.
- Initial protected CI at `0261a1fd` passed every application-behavior, browser,
  security and recipe job but its application build exhausted Node 22's 4 GiB
  TypeScript heap. Reproducing its package-build ordering added 41 generated
  declaration roots and measured 4,226,377 KiB of compiler memory locally.
  Next now uses a production TypeScript configuration covering every one of
  the 1,627 tracked runtime TypeScript files and generated route types. The
  unchanged full-project typecheck still checks tests and tooling separately.
  Production compiler memory fell to 3,440,838 KiB; a complete Node 22.23.2
  build and scrub passed with 20,362 files and 243,617,631 bytes. Full typecheck
  and all 25 focused artifact/schema/topology/merge contracts passed. No heap,
  deadline or assertion was relaxed; renewed protected CI is still required.

The opt-in older-artifact fixture is `tests/fixtures/import-old-image.probe.ts`.
After the ordinary browser owner fixture exists in an explicitly named test
database, boot an older standalone build on a separate localhost port with
workers and migration disabled. Set `TEST_DATABASE_URL`, `APP_URL`, the matching
test `SESSION_SECRET`, and `FREEHOLDER_OLD_IMPORT_IMAGE_URL`, then run
`node tests/fixtures/run-import-old-image-probe.mjs`. It adds isolated proof
imports and a fixture-owner session without truncating the database. Never
point this fixture or its older application at a real instance.

## Work still required

Final protected checks remain required. Local typecheck, lint, license,
changeset and plan checks pass; the 42-file static contract run passed 380
cases with one documented exclusion. The final authority/matrix/encoding
documentation checks subsequently passed all 26 cases.
An initial sandboxed rerun was invalidated by nested git/listen EPERM errors;
the affected checks were rerun with those local capabilities and passed.
The native suite's corrected real-post ownership control and populated 72→73
fixture have passed; earlier failures above remain recorded to distinguish
fixture corrections from green evidence. Other source adapters must receive
the durable continuation contract; the WXR vertical alone does not complete
C3.22.

Core media's physical PUT ownership has five genuine before failures in the
separate primitive lane. A successful physical write followed by a lost Asset
reply does not establish recovery from an unresolved, delayed or ambiguous
physical PUT. The additional actual probes show late writers crossing cleanup
and cleanup in a replacement namespace forgetting original-store bytes.
Neither clocks nor GET-not-found may establish settlement in a replacement
namespace. These are required dependencies, not optional deferrals.

Historical reader-email ownership, complete source-specific cutover and actual
provider/owner acceptance also remain required. Coding-agent review is not the
independent security sign-off in C11.10.
