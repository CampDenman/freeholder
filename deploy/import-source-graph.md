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


## Uploaded REST source qualification on reader78

The uploaded REST increment now composes on qualified reader78 checkpoint
`05337220` with the current physical source namespace and original-reader hold
boundaries intact. Its source head before the browser fixture is `5ac57f46`.
Full types pass. The unchanged JSON/range and REST index pure controls passed
22 cases on the reader source integration; no parser was changed in the final
reader rebase.

A fresh normal 0–78 database then passed the actual 501-record REST source
lifecycle in 110.12 seconds. Independent processes accepted 500 and then one
original JSON range, using distinct worker PIDs. The normal CMS spine published
all 501 posts with their shared author/category, reconciled their source links,
and rolled back every imported page/post/author/category. No migration SQL was
applied manually, no source identity was synthesized from position, and no test
deadline, storage guard or assertion was weakened. The initial attempt on the
older reader database stopped at the worker's deliberate requirement that a
disposable name contain `test`; that configuration refusal is retained separately
from the successful explicitly named fresh-database proof.

The shared owner browser fixture now covers both actual WXR XML and actual REST
JSON originals, including pause after the accepted 500-page receipt, reload,
identical-source restore, reviewed cross-batch rename, public links, publication
and reversal in four locales. The new REST browser cases are written and pass
static checks; their production execution, current SDK refresh and final source
gates remain pending. This uploaded JSON source increment does not supply live
REST discovery or durable ZIP/crawl response/frontier storage. C3.47 and stable
acceptance remain open.


The frozen REST runtime source `0180cf44` now passes live SDK generation (all
eight controls, 3.04 seconds, no catalog diff), every source gate (full types,
lint, licensing, notes, plan, playground, 384 contracts and 26 expected DB-only
exclusions), and Node22.23.2 production build/artifact scrub: 21,329 files and
264,503,845 bytes with no source/environment leakage. Its production standalone
is separate from the preserved reader78 and historical artifacts.

The actual REST JSON 501-page owner journey passed in English in 1.1 minutes.
All three remaining locale journeys initially passed their functional assertions
in 3.0 minutes, but background reader-review queries revealed `58P01`: the local
bundled Postgres compiler could not load `libLLVM-17.so.1`. Those logs remain
recorded; that run is not clean default-JIT acceptance. The disposable test
cluster was explicitly configured with `jit=off`, and the exact unchanged source
and production artifact then passed Spanish, French and Arabic again in 2.4
minutes with no compiler, failed-query or server-error entries in the complete
logs. A direct post-run read confirmed `jit=off`, `fsync=on` and all 79 normal
journal entries. No product, schema, assertion, deadline or durability setting
was changed. PostgreSQL documents the [JIT configuration switch](https://www.postgresql.org/docs/16/jit-configuration.html);
this is an explicit local test-environment profile, not a provider or default-JIT
acceptance claim.

All four production journeys use the real source upload, accepted 500-page
receipt, pause, reload, identical original restore, saved review/rename,
publication, public cross-batch link and rollback. They cover 320px, both themes,
keyboard, Axe and Arabic RTL. Playwright, standalone servers and database clients
drained with exit zero. Exact protected integration and broader source/provider
acceptance remain required. This locally qualified uploaded-REST increment does
not complete live REST discovery, durable ZIP/crawl continuation or C3.47.


## Selected REST instance boundary

Inspection after the root-site qualification found a separate subdirectory
boundary in the existing shared start operation. A bounded actual start/crawl
control now proves it: selecting `https://fictional-rest-instances.example/site-a/`
saved only its host, sent the public API requests to `/wp-json/` at that host,
and staged a different host-root article/site instead of the selected instance.
The before failure is an exact four-field value mismatch, not a reader ownership
failure. REST comment parsing is not implemented, so no wrong-person claim is
made from this control.

Two earlier attempts stopped in fixture setup (a standard reset hook timeout,
then duplicate fixture plugin reviews). Their logs/source are retained separately;
neither supplies product before evidence. The final append-only fresh-UUID
fixture preserves existing review rows and reached the actual target assertions.
Its runner reported 4.72 seconds, but a coordinator grant race overlapped the
commerce repeat on another database. That overlap is explicit: this supplies a
deterministic wrong-target observation, not quiet-lane/performance evidence.
The frozen0180 root-site artifact facts above remain valid; the subdirectory
repair and its affected qualification remain required before normal integration.


The selected-instance repair now passes the unchanged four-field control in
4.12 seconds on its separately granted lane: the new run retains `/site-a/`,
its default public requests address that instance's API, and its staged site and
article belong to the selected instance. Source lint and full types pass.
Starting a new non-root REST source now retains its selected path while excluding
query/fragment from site identity. Root-site starts retain their previous value;
existing saved runs are preserved rather than inferred or rewritten from links.
No parser, reader assignment, schema, deadline or fsync setting changed. The
frozen0180 root-site artifact qualification remains separate from this narrow
source repair; protected integration and any affected subdirectory artifact
acceptance remain required. This does not add REST reader-comment parsing or
close live discovery/durable ZIP/crawl/WordPress acceptance.


## REST review on actual protected migration 78 main

Reader provenance PR #687 merged normally as
`bf131de797cb97a8b929e749d88a2176dfad3c03`. The REST-only commits now replay
on that actual main ancestry, with product files and SQL identical to the
previously qualified source checkpoint 6b05fdff. All prior SQL remains unchanged;
this increment adds no migration or table. Local full types, lint, license,
release-note, plan, playground and 384 contract gates passed again, with 26
expected database-only exclusions. MASTER §43.1 is unchanged.

The preserved 0180 root-site production artifact predates the narrow selected
subdirectory fix. Its real root-site SDK/native/four-locale evidence above is
retained with that scope; it is not attributed to a subdirectory artifact.
The actual start/preview subdirectory before/after controls remain the source
proof for that fix. A new English owner production case selects /site-a/,
uploads 501 originals from that instance and checks the actual HTTP-created run
retains its selected origin, then uses the existing interruption, identical-byte
restore, publication and full rollback journey. Protected CI must build and run
that current case before integration; no local subdirectory artifact result is
claimed here. Other locale journeys retain their original root-site inputs.

Applicable F01–F12 evidence for this partial C3.47/C3.46 repair uses existing
migration 73 constraints and immutable source/lease/actor records, shared
transactional CMS/media paths and rollback ownership (F01–F03); existing
translated owner progress/review/restore controls and unchanged HTTP/MCP/SDK
contracts (F04–F06); actual source/body/metadata bounds, duplicate/replay/source
refusal and source privacy/hold recovery (F07–F09); owner source-file guidance,
release notes and the real 501-source end-to-end native/browser paths (F10–F12).
There is no new CRM FK or source body copy. Existing contact registry and erasure
boundaries remain authoritative. REST comment parsing, full WordPress parity,
ZIP/crawl durable continuation, actual cutover/provider acceptance, independent
review and stable readiness remain open. This source increment does not close
C3.47 or change the version/announcement status.


A further actual pure before control found native JSON syntax failures quote
original record content. The initial-preview error handler retains that message
on the run, so raw parsing must not supply source excerpts. The controlled
fictional input before failed in 871ms because its body appeared in the error.
The parser now reports only the original record ordinal and a constant invalid
UTF-8/JSON diagnostic, with no original exception cause retained. All 23
JSON/range/REST after controls pass in 5.19 seconds; the original malformed-input
refusals and byte/identity checks remain unchanged. This diagnostic-only repair
changes no valid-source result, actor authority, source byte or schema. The
current protected head still requires its complete gate rerun.


Protected CI on REST head 4a3d701f passed all 46 checks, including the newly
added real English subdirectory owner journey. Browser shard 2 passed 64 tests
in 12.5 minutes and its current production artifact scrub passed: 21,325 files,
262,314,077 bytes, no source/environment leakage. That shard ran all four REST
locale journeys; English selected /site-a/ through the real HTTP action before
501-record interruption, restore, publication and rollback. This supplies the
current subdirectory artifact result previously pending; it is not the old 0180
root artifact. The diagnostic-only privacy correction requires a new exact-head
protected rerun despite preserving all valid-source results.

The first privacy-fix gate run caught only a test catch binding typed as any.
After annotating it unknown, the complete gate rerun passed: full types, lint,
license, notes, plan/F-matrix, playground and 384 contracts with 26 expected
exclusions. The corrected protected head still needs its exact CI rerun.


## Static ZIP original-directory foundation (source only)

The isolated directory adapter retains real `archive-zip` file paths, physical
local-frame ranges, sizes, CRC values and supported media kinds. It does not
manufacture WordPress IDs, authors, taxonomies or menus. Its directory fingerprint
binds normalized directory facts; it does not substitute for the original private
range reader's manifest authorization and cryptographic chunk digests.

Validation caps the complete directory at 10,000 entries and 16 MB of metadata,
retains the existing 100 MB expansion limit, checks actual local header/name
consistency, refuses overlapping frames and preserves literal encoded paths.
Local frames and selected payloads are read in physical source order so a hostile
central-directory ordering cannot repeatedly download private chunks. One payload
phase selects at most 500 distinct files within the ordinary 20 MB body budget,
with the existing single-media 25 MB allowance. No source body is copied into the
directory facts. The ordinary small-ZIP path retains its prior read cap; only the
new bounded 10,000-entry adapter has its own larger fixed metadata-read allowance.

All 43 pure directory/ordinary-archive controls pass in 1.71 seconds, including
real 501-file and 10,000-file ZIPs, the first excess entry, hostile paths/flags,
CRC damage, invalid declared UTF-8, contradictory local names, raw frame order,
original file reads and a real bounded 500-file payload phase. Lint and targeted
changed-module/type tests pass using the same installed locked dependencies,
without dependency installation or artifact copying. No database was used.

This is an internal primitive, not a shipped resumable ZIP pipeline. The existing
runtime still has its 500-page small-ZIP limit. Graph catalog/phase integration,
privacy/ownership/recovery native proofs and owner browser acceptance remain
required. Durable crawl response/frontier schema81 has not been written or
journalled here; its actual 79/80 predecessors must exist before a contiguous
qualification claim. C3.47 and stable readiness remain open.


The directory primitive also keeps ignored packaging outside the detected site
root under its actual original path, with no invented public URL. Its updated
real-byte fixtures pass all 44 directory/ordinary-archive controls in 1.83 seconds;
lint and targeted changed-module types pass. This remains source-only: no graph
runtime, schema81, provider acceptance or complete ZIP/crawl claim is added.


The next source-only ZIP increment reuses the ordinary static HTML parser for
bounded indexing phases, rather than converting static files into WordPress
records. Actual 501-file input now produces a 500-file phase and a one-file
continuation with stable real-path identities, original frame facts and page
content digests. The returned index contains page/SEO/image metadata and no
shadow HTML bodies; asset facts are not presented as verified asset-content
hashes. Global slug collisions are reconstructed from original path order, so
resumption produces the same suffixes across a phase boundary. Ignored-only
final phases still revalidate the actual directory. Per-phase page count,
20 MB body/read and 60-second budgets and complete-source body/metadata caps
remain explicit. This is not yet connected to the service graph/catalog.

The changed parser and actual ZIP phases plus ordinary archive/content
regressions pass 54 pure controls in 3.00 seconds. Targeted changed-module types
and lint pass against the existing installed dependencies. No PG, browser,
provider request, new migration or production build was used. Runtime source
binding, media/CMS graph integration and actual interruption/publication/rollback
qualification still remain required; C3.47 stays open.


A subsequent source-only phase refinement also validates and hashes actual
media payloads, rather than deriving content hashes from directory facts.
Content and media share the ordinary 20MB read phase, with a single media file
up to 25MB in its own phase. A real 21MB original-file control proves the phase
boundary, digest and absence of returned payload copies; page-body accounting
remains separate. The updated directory/static/content batch passes 55 pure
controls in 3.05 seconds, with targeted types and lint. These primitives still
have no runtime source-graph integration or schema 81 acceptance.

The ZIP cursor now names its actual original-file ordinal explicitly, matching
migration 73's monotonic cursor guard. Entry metadata is capped at the existing
16KB per-row SQL limit. The same 55 pure controls pass in 3.40 seconds; targeted
types and lint pass. No existing migration or runtime source route is changed.

A strict format-discriminated ZIP graph-row contract now retains the actual file
frame, normalized facts digest and separate real-content digest. Static assets
use the existing attachment row kind without WordPress IDs; ignored files retain
facts without invented content hashes or public URLs. Runtime validation refuses
shadow bodies, fabricated WordPress fields, inconsistent original frame/row
bindings and mismatched file-fact digests. The real-file mapping and ordinary
archive/content batch passes 56 pure controls in 3.35 seconds; targeted types and
lint pass. This contract is not yet wired into the shared service graph.

The original committed runtime at test-only checkpoint 7cbf44b5 has now been
exercised through an actual 501-page ZIP upload on a cloned normal 0–78 database.
Its bounded-start before control genuinely failed in 10.16 seconds: the service
returned failed with its existing 500-page limit instead of reserving durable
continuation. No parser count or synthetic source was substituted. This test-only
checkpoint retains the old runtime route; ongoing service changes remain separate.
Its native process exited, and the fixture database had zero nonidle backends
before the shared lane was handed to the next qualifier. Source-only graph format
and ordinary ZIP/WXR parser controls currently pass 60 pure cases in 4.33 seconds.
Actual after/lifecycle, privacy/hold/namespace and owner-browser qualification
remain required. No schema 81, provider acceptance or C3.47 closure is claimed.

The exact original basic 501-ZIP start-after control now passes in 9.20 seconds
on normal 0–78. It uses the unchanged basic source/assertions from the genuine
before, reserves bounded continuation and retains the actual original ZIP bytes.
The native process exited and its database had zero nonidle backends before the
lane handoff. This proves initial reservation only: the larger multi-process
index/media/CMS/publication/rollback control is prepared but has not run yet.
The separate full lifecycle fixture also crosses an actual private source-chunk
boundary; it is not presented as an executed result. No complete ZIP, crawl,
provider or stable acceptance is claimed.

A controlled-clock pure before exposed a missing budget check in direct local
ZIP-frame validation: actual original headers could finish after the directory
deadline without refusal. The new guard checks before and after each frame read.
All 61 directory/static/content/WXR controls pass in 3.96 seconds, including the
exact refusal; the clock control is not a wall-time provider benchmark. No
budget or timeout was extended. The shared link adapter also preserves literal
static URL facts while using the existing source-path convention for resolution;
its real cross-batch link assertion remains in the pending full lifecycle case.


The first full ZIP lifecycle attempt stopped at a genuine media-receipt guard
in 17.49 seconds. Its two independent processes had accepted 500+2 real files,
including 501 HTML pages and an actual shared image across a private source-chunk
boundary. Original-file metadata/digests and absence of invented WordPress fields
passed before the first image claim. The receipt guard expected child-owned raw
bytes, while the immutable source correctly remains on the root. Publication and
rollback had not run and are not claimed.

The source repair centralizes that lookup. Only the exact service context that
locked and validated the live parent, plus the child's stored operation binding
and matching source kind, can resolve its actual parent. Both commit preparation
and media receipts retain their source/preview/manifest checks against that owner.
The asset receipt still belongs to its real child batch; neither the original
source run ID nor its storage identity is rewritten. Full types and targeted lint
pass. The unchanged fresh lifecycle control remains pending its next sole-PG lease.


With the root-source repair, the fresh lifecycle reached actual image creation,
501-page publication, cross-batch link acceptance and complete page rollback in
49.65 seconds. Its last fixture assertion wrongly required zero raw Asset rows.
Read-only evidence instead showed the exact original Asset already trashed,
with every child/root kept-media and kept-page list empty. The existing shared
rollback service deliberately uses recoverable trash. This was a fixture-policy
error, not an observed cleanup/ordering defect; no production retention/deletion
guard was changed. The corrected control requires the exact original Asset to
be trashed, zero active assets, zero actual page/section usage and real public
media delivery changing from 200 to 404 through the existing route. The earlier
failure remains preserved; this corrected full case still needs its next run.


The corrected original 501-page ZIP lifecycle now passes on signed source
`2af201384b8dc40eed040da61b03034fb9bd109c`: one selected native case in
49.93 seconds, with the basic reservation case intentionally filtered. Two
independent processes accepted 500 then two real original files (501 HTML pages
and one shared PNG), across actual private source-chunk boundaries. The exact
reviewed rename, cross-batch link, shared media, explicit publication and all
501 page reversals passed. The exact original image remained recoverably trashed
with zero active assets and zero page/section usage; the real anonymous media
route changed from 200 to 404. No retention or deletion guard was relaxed.

The native process exited successfully and the owned disposable database had
zero nonidle backends before the shared lane was returned. This qualification
uses the explicitly configured local PostgreSQL profile `jit=off`, `fsync=on`;
it is not default-JIT or actual-provider acceptance. The preserved raw-row
expectation failure above remains a fixture-policy diagnostic. Production ZIP
artifact/browser, cancellation/privacy/hold/namespace controls and durable live
crawl continuation remain required. No migration 81, C3.47 completion, stable
readiness, permanent byte erasure or deployed cutover is claimed.


The prepared-private-child boundary before control genuinely failed on unchanged
source `de2f214e` in 10.91 seconds. After actual 501-file ZIP indexing and accepted
private media preview, it refused direct child access, verified an identical
replacement upload and proved that the stored child checkpoint was unchanged.
Resuming through the actual root then refused the historical physical descriptor
instead of using the newly verified identical original. The process exited and
its owned normal 0–78 database had no nonidle backends before handoff. This is a
resume defect, not evidence of a cross-owner read or overwritten original.

The source repair keeps the historical child descriptor intact and compares its
original root, revision, byte geometry and complete chunk digests to the active
parent's retained source only after the exact parent service context has passed
its existing authority/lease/batch guards. Reads still use the active parent's
verified current physical locator and its namespace/expiry checks. Ordinary
non-graph archive binding remains exact. The native after control is not yet run.


REST PR #688 is now actually merged through the protected queue at
`25f307a0aedff9a59d10ac2f1994c0ed510faec6`; all 46 exact-head checks and
merge-group run 43225912971 passed. The ZIP branch is composed on that real
main ancestor, including already-merged lead schema79. Its import source diff
against the previously qualified ZIP runtime adds only the merged REST
selected-subdirectory repair before the narrow ZIP restoration repair. Both
the ZIP owner fixture and REST/en selected-subdirectory fixture were preserved.

On signed repair `9fb9ebf7`, the exact prepared-child after case passes in
8.51 seconds. A newly created disposable database applied the complete normal
0–79 journal (80 entries, latest timestamp 1793310000059), without separate
unpublished SQL. The unchanged control proves direct private-child denial,
identical verified restoration, unchanged original child checkpoint and exactly
one accepted image through the live parent. The native process exited and its
database had zero nonidle backends before lane handoff. Full types and targeted
changed-file lint also pass. The local JIT/fsync profile above still applies.
The new ZIP privacy/hold and storage-namespace controls are prepared but unrun;
current ZIP production artifact/browser and complete crawl acceptance remain
required. No existing migration was edited and no schema81 was added.


Exactly three additional ZIP graph boundary cases pass in 20.00 seconds on
`1836ea578866b2812fe5454737b9cbb70c6473fe` and the owned normal0–79 fixture.
The two existing WXR counterparts were intentionally filtered. A real unparsed
501-file ZIP is invalidated by actual erasure, and its in-flight index result is
refused. A real named reader-source hold preserves the exact original through
rollback until that hold is removed. An independent same-key copy in storage B
authorizes no reads or writes: continuation produces zero B GET/PUT/DELETE and
zero accepted entries, while returning to actual original storage A resumes
500 entries. Both stores' bytes remain unchanged during the refusal.

All test processes exited successfully and the fixture database had no nonidle
backends before the next native lease. The existing local JIT/fsync profile
applies. These are source-specific local controls, not actual-provider object
recovery or default-JIT acceptance. Current ZIP production artifact, live SDK
verification, four-locale owner browser, protected qualification and durable
live crawl response/frontier integration remain required.


The ZIP source now passes all eight live SDK controls with `UPDATE_SDK=1` under
Node22.23.2 on normal0–79 (5.65 seconds), with no generated catalog diff. The
direct generator's underlying Vitest command was used before replacing the known
dependency symlink, avoiding an implicit `pnpm exec` install. Its process exited
and the owned database had no nonidle backends. An independent frozen offline
dependency installation then completed in 0.71 seconds.

Every source gate component passes: full types (46.9 seconds), whole-repository
lint (74.4 seconds), playground policy, licensing, release notes, plan/F-matrix
and all 44 contract files (384 passed, 26 expected database exclusions, 31.89
seconds). The first launch lacked the required sandbox escalation and could not
spawn git/shell helpers or bind three loopback test servers. That diagnostic is
preserved; only the affected licensing/notes/plan/contracts were rerun under
normal reviewed escalation. They all pass with no code, guard or expectation
change. All source processes are drained. ZIP production build/artifact and
four-locale owner-browser acceptance remain pending.
